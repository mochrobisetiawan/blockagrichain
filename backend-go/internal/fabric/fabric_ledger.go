package fabric

import (
	"context"
	"crypto/sha256"
	"encoding/asn1"
	"encoding/hex"
	"math/big"
	"strconv"
	"strings"

	"github.com/hyperledger/fabric-gateway/pkg/client"
	"github.com/hyperledger/fabric-protos-go-apiv2/common"
	"github.com/hyperledger/fabric-protos-go-apiv2/msp"
	"github.com/hyperledger/fabric-protos-go-apiv2/peer"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

// readerMSP — MSP apa pun yang punya akses Reader channel cukup untuk query qscc/event.
const readerMSP = "PetaniMSP"

// ── Pemetaan error chaincode → pesan + flag akses (untuk HTTP 403/400) ──

type ChainError struct {
	Msg          string
	AccessDenied bool
}

func (e *ChainError) Error() string { return e.Msg }

func mapErr(err error) error {
	if err == nil {
		return nil
	}
	msg := err.Error()
	if st, ok := status.FromError(err); ok && st.Message() != "" {
		msg = st.Message()
	}
	// Ambil pesan bisnis dari chaincode bila ada ("ACCESS_DENIED: ..." / "...: <pesan>").
	if i := strings.Index(msg, "ACCESS_DENIED:"); i >= 0 {
		clean := strings.TrimSpace(msg[i+len("ACCESS_DENIED:"):])
		clean = strings.SplitN(clean, "\n", 2)[0]
		return &ChainError{Msg: clean, AccessDenied: true}
	}
	return &ChainError{Msg: msg, AccessDenied: false}
}

// ── Pembaca blok via qscc (Query System Chaincode) ──

type TxSummary struct {
	TxID         string `json:"txId"`
	Type         string `json:"type"`
	MspID        string `json:"mspId"`
	FunctionName string `json:"functionName"`
	Key          string `json:"key"`
	Timestamp    int64  `json:"timestamp"`
}

type BlockSummary struct {
	Number       uint64      `json:"blockNumber"`
	DataHash     string      `json:"dataHash"`
	PreviousHash string      `json:"prevHash"`
	HeaderHash   string      `json:"hash"`
	TxCount      int         `json:"txCount"`
	Txs          []TxSummary `json:"txs"`
}

func (m *Manager) sysContract() (*client.Contract, error) {
	gw, err := m.gatewayFor(readerMSP)
	if err != nil {
		return nil, err
	}
	return gw.GetNetwork(m.cfg.FabricChannel).GetContract("qscc"), nil
}

// ChainHeight — tinggi blockchain (jumlah blok).
func (m *Manager) ChainHeight() (uint64, error) {
	ct, err := m.sysContract()
	if err != nil {
		return 0, err
	}
	res, err := ct.EvaluateTransaction("GetChainInfo", m.cfg.FabricChannel)
	if err != nil {
		return 0, mapErr(err)
	}
	info := &common.BlockchainInfo{}
	if err := proto.Unmarshal(res, info); err != nil {
		return 0, err
	}
	return info.GetHeight(), nil
}

// GetBlock — ambil & ringkas satu blok berdasarkan nomor.
func (m *Manager) GetBlock(num uint64) (*BlockSummary, error) {
	ct, err := m.sysContract()
	if err != nil {
		return nil, err
	}
	res, err := ct.EvaluateTransaction("GetBlockByNumber", m.cfg.FabricChannel, strconv.FormatUint(num, 10))
	if err != nil {
		return nil, mapErr(err)
	}
	block := &common.Block{}
	if err := proto.Unmarshal(res, block); err != nil {
		return nil, err
	}
	return summarizeBlock(block), nil
}

// ListBlocks — N blok terbaru (Blockchain Explorer).
func (m *Manager) ListBlocks(take int) ([]*BlockSummary, error) {
	height, err := m.ChainHeight()
	if err != nil {
		return nil, err
	}
	if take <= 0 || take > 200 {
		take = 50
	}
	var start uint64
	if height > uint64(take) {
		start = height - uint64(take)
	}
	out := []*BlockSummary{}
	for n := height; n > start; n-- {
		b, err := m.GetBlock(n - 1)
		if err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, nil
}

// IntegrityResult — hasil verifikasi rantai hash (Verification Tool).
type IntegrityResult struct {
	Intact           bool    `json:"intact"`
	TotalBlocks      uint64  `json:"totalBlocks"`
	BrokenBlocks     int     `json:"brokenBlocks"`
	FirstBrokenBlock *uint64 `json:"firstBrokenBlock"`
	HeadHash         string  `json:"headHash"`
}

// Integrity — verifikasi keterkaitan prev-hash antar blok native Fabric.
func (m *Manager) Integrity() (*IntegrityResult, error) {
	height, err := m.ChainHeight()
	if err != nil {
		return nil, err
	}
	res := &IntegrityResult{Intact: true, TotalBlocks: height}
	var prevHeaderHash []byte
	for n := uint64(0); n < height; n++ {
		ct, _ := m.sysContract()
		raw, err := ct.EvaluateTransaction("GetBlockByNumber", m.cfg.FabricChannel, strconv.FormatUint(n, 10))
		if err != nil {
			return nil, mapErr(err)
		}
		block := &common.Block{}
		if err := proto.Unmarshal(raw, block); err != nil {
			return nil, err
		}
		h := block.GetHeader()
		if n > 0 && !equalBytes(h.GetPreviousHash(), prevHeaderHash) {
			res.Intact = false
			res.BrokenBlocks++
			if res.FirstBrokenBlock == nil {
				bn := n
				res.FirstBrokenBlock = &bn
			}
		}
		prevHeaderHash = blockHeaderHash(h)
	}
	res.HeadHash = hex.EncodeToString(prevHeaderHash)
	return res, nil
}

// ── Listener event chaincode → callback (untuk mirror off-chain + notifikasi + feed) ──

func (m *Manager) ListenEvents(ctx context.Context, handle func(name, txID string, block uint64, payload []byte)) error {
	gw, err := m.gatewayFor(readerMSP)
	if err != nil {
		return err
	}
	network := gw.GetNetwork(m.cfg.FabricChannel)
	events, err := network.ChaincodeEvents(ctx, m.cfg.FabricChaincode)
	if err != nil {
		return err
	}
	for e := range events {
		handle(e.EventName, e.TransactionID, e.BlockNumber, e.Payload)
	}
	return nil
}

// ── Helper parsing & hashing blok ──

func summarizeBlock(b *common.Block) *BlockSummary {
	h := b.GetHeader()
	s := &BlockSummary{
		Number:       h.GetNumber(),
		DataHash:     hex.EncodeToString(h.GetDataHash()),
		PreviousHash: hex.EncodeToString(h.GetPreviousHash()),
		HeaderHash:   hex.EncodeToString(blockHeaderHash(h)),
		TxCount:      len(b.GetData().GetData()),
	}
	for _, env := range b.GetData().GetData() {
		if tx := parseTx(env); tx != nil {
			s.Txs = append(s.Txs, *tx)
		}
	}
	return s
}

func parseTx(envBytes []byte) *TxSummary {
	env := &common.Envelope{}
	if proto.Unmarshal(envBytes, env) != nil {
		return nil
	}
	payload := &common.Payload{}
	if proto.Unmarshal(env.GetPayload(), payload) != nil {
		return nil
	}
	ch := &common.ChannelHeader{}
	if proto.Unmarshal(payload.GetHeader().GetChannelHeader(), ch) != nil {
		return nil
	}
	sh := &common.SignatureHeader{}
	_ = proto.Unmarshal(payload.GetHeader().GetSignatureHeader(), sh)
	creator := &msp.SerializedIdentity{}
	_ = proto.Unmarshal(sh.GetCreator(), creator)

	fn, key := parseInvocation(ch.GetType(), payload.GetData())
	return &TxSummary{
		TxID:         ch.GetTxId(),
		Type:         common.HeaderType_name[ch.GetType()],
		MspID:        creator.GetMspid(),
		FunctionName: fn,
		Key:          key,
		Timestamp:    ch.GetTimestamp().GetSeconds(),
	}
}

// parseInvocation — ekstrak nama fungsi chaincode (args[0]) + argumen kunci (args[1])
// dari transaksi ENDORSER_TRANSACTION. Best-effort; kosong bila bukan invoke chaincode.
func parseInvocation(headerType int32, payloadData []byte) (string, string) {
	if headerType != int32(common.HeaderType_ENDORSER_TRANSACTION) {
		return "", ""
	}
	tx := &peer.Transaction{}
	if proto.Unmarshal(payloadData, tx) != nil || len(tx.GetActions()) == 0 {
		return "", ""
	}
	cap := &peer.ChaincodeActionPayload{}
	if proto.Unmarshal(tx.GetActions()[0].GetPayload(), cap) != nil {
		return "", ""
	}
	cpp := &peer.ChaincodeProposalPayload{}
	if proto.Unmarshal(cap.GetChaincodeProposalPayload(), cpp) != nil {
		return "", ""
	}
	cis := &peer.ChaincodeInvocationSpec{}
	if proto.Unmarshal(cpp.GetInput(), cis) != nil {
		return "", ""
	}
	args := cis.GetChaincodeSpec().GetInput().GetArgs()
	fn, key := "", ""
	if len(args) > 0 {
		fn = string(args[0])
	}
	if len(args) > 1 {
		key = string(args[1])
	}
	return fn, key
}

type asn1Header struct {
	Number       *big.Int
	PreviousHash []byte
	DataHash     []byte
}

// blockHeaderHash — replika protoutil.BlockHeaderHash (sha256 atas ASN.1 header).
func blockHeaderHash(h *common.BlockHeader) []byte {
	asn1Bytes, err := asn1.Marshal(asn1Header{
		Number:       new(big.Int).SetUint64(h.GetNumber()),
		PreviousHash: h.GetPreviousHash(),
		DataHash:     h.GetDataHash(),
	})
	if err != nil {
		return nil
	}
	sum := sha256.Sum256(asn1Bytes)
	return sum[:]
}

func equalBytes(a, b []byte) bool { //nolint:revive
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
