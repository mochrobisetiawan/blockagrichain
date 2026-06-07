package fabric

import (
	"crypto/x509"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/hyperledger/fabric-gateway/pkg/client"
	"github.com/hyperledger/fabric-gateway/pkg/identity"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"

	"blockagrichain/backend/internal/config"
)

// Manager — kelola koneksi Fabric Gateway per organisasi MSP.
// Tiap transaksi dikirim memakai identitas MSP yang sesuai dengan peran pemanggil,
// sehingga kontrol akses (RBAC) di chaincode ditegakkan oleh sertifikat asli.
type Manager struct {
	cfg      *config.Config
	mu       sync.Mutex
	gateways map[string]*orgGateway
	clientCN map[string]string // mspID → CommonName identitas (untuk FabricClientId)
}

type orgGateway struct {
	gw   *client.Gateway
	conn *grpc.ClientConn
}

// domainForMSP — pemetaan MSP → domain DNS org (sesuai crypto-config.yaml).
var domainForMSP = map[string]string{
	"PetaniMSP":   "petani.blockagri.id",
	"BulogMSP":    "bulog.blockagri.id",
	"KementanMSP": "kementan.blockagri.id",
	"KemenkeuMSP": "kemenkeu.blockagri.id",
	"PIHCMSP":     "pihc.blockagri.id",
}

func New(cfg *config.Config) *Manager {
	return &Manager{cfg: cfg, gateways: map[string]*orgGateway{}, clientCN: map[string]string{}}
}

func (m *Manager) Close() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, g := range m.gateways {
		g.gw.Close()
		_ = g.conn.Close()
	}
}

// ── Path materi kripto (hasil cryptogen) ──

func (m *Manager) peerTLSCA(domain string) string {
	return filepath.Join(m.cfg.FabricCryptoPath, "peerOrganizations", domain,
		"peers", "peer0."+domain, "tls", "ca.crt")
}

func (m *Manager) userMSPDir(domain string) string {
	return filepath.Join(m.cfg.FabricCryptoPath, "peerOrganizations", domain,
		"users", "User1@"+domain, "msp")
}

// firstFile — ambil file pertama dalam direktori (keystore/signcerts namanya acak).
func firstFile(dir string) (string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return "", err
	}
	for _, e := range entries {
		if !e.IsDir() {
			return filepath.Join(dir, e.Name()), nil
		}
	}
	return "", fmt.Errorf("tidak ada file di %s", dir)
}

func (m *Manager) newIdentity(mspID, domain string) (*identity.X509Identity, string, error) {
	certPath, err := firstFile(filepath.Join(m.userMSPDir(domain), "signcerts"))
	if err != nil {
		return nil, "", err
	}
	certPEM, err := os.ReadFile(certPath)
	if err != nil {
		return nil, "", err
	}
	cert, err := identity.CertificateFromPEM(certPEM)
	if err != nil {
		return nil, "", err
	}
	id, err := identity.NewX509Identity(mspID, cert)
	if err != nil {
		return nil, "", err
	}
	return id, cert.Subject.CommonName, nil
}

func (m *Manager) newSign(domain string) (identity.Sign, error) {
	keyPath, err := firstFile(filepath.Join(m.userMSPDir(domain), "keystore"))
	if err != nil {
		return nil, err
	}
	keyPEM, err := os.ReadFile(keyPath)
	if err != nil {
		return nil, err
	}
	pk, err := identity.PrivateKeyFromPEM(keyPEM)
	if err != nil {
		return nil, err
	}
	return identity.NewPrivateKeySign(pk)
}

func (m *Manager) newConn(mspID, domain string) (*grpc.ClientConn, error) {
	caPEM, err := os.ReadFile(m.peerTLSCA(domain))
	if err != nil {
		return nil, fmt.Errorf("baca TLS CA peer %s: %w", mspID, err)
	}
	cp := x509.NewCertPool()
	if !cp.AppendCertsFromPEM(caPEM) {
		return nil, fmt.Errorf("TLS CA peer %s tidak valid", mspID)
	}
	peerHost := "peer0." + domain // server name untuk verifikasi TLS
	creds := credentials.NewClientTLSFromCert(cp, peerHost)
	return grpc.NewClient(m.cfg.PeerEndpoints[mspID], grpc.WithTransportCredentials(creds))
}

// gatewayFor — dapatkan (atau buat) gateway untuk satu MSP.
func (m *Manager) gatewayFor(mspID string) (*client.Gateway, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if g, ok := m.gateways[mspID]; ok {
		return g.gw, nil
	}
	domain, ok := domainForMSP[mspID]
	if !ok {
		return nil, fmt.Errorf("MSP tidak dikenal: %s", mspID)
	}
	conn, err := m.newConn(mspID, domain)
	if err != nil {
		return nil, err
	}
	id, cn, err := m.newIdentity(mspID, domain)
	if err != nil {
		_ = conn.Close()
		return nil, err
	}
	sign, err := m.newSign(domain)
	if err != nil {
		_ = conn.Close()
		return nil, err
	}
	gw, err := client.Connect(id,
		client.WithSign(sign),
		client.WithClientConnection(conn),
		client.WithEvaluateTimeout(15*time.Second),
		client.WithEndorseTimeout(30*time.Second),
		client.WithSubmitTimeout(30*time.Second),
		client.WithCommitStatusTimeout(2*time.Minute),
	)
	if err != nil {
		_ = conn.Close()
		return nil, err
	}
	m.gateways[mspID] = &orgGateway{gw: gw, conn: conn}
	m.clientCN[mspID] = cn
	return gw, nil
}

func (m *Manager) contract(mspID string) (*client.Contract, error) {
	gw, err := m.gatewayFor(mspID)
	if err != nil {
		return nil, err
	}
	return gw.GetNetwork(m.cfg.FabricChannel).GetContract(m.cfg.FabricChaincode), nil
}

// ClientCN — CommonName identitas org (dipakai mengisi FabricClientId saat seeding).
func (m *Manager) ClientCN(mspID string) (string, error) {
	if _, err := m.gatewayFor(mspID); err != nil {
		return "", err
	}
	return m.clientCN[mspID], nil
}

// Proof — bukti blockchain yang disertakan ke frontend.
type Proof struct {
	TxID        string `json:"txId"`
	BlockNumber uint64 `json:"blockNumber"`
	BlockHash   string `json:"blockHash"`
}

// Submit — kirim transaksi (invoke) sebagai identitas mspID. Mengembalikan hasil + bukti.
func (m *Manager) Submit(mspID, fn string, args ...string) ([]byte, *Proof, error) {
	ct, err := m.contract(mspID)
	if err != nil {
		return nil, nil, err
	}
	proposal, err := ct.NewProposal(fn, client.WithArguments(args...))
	if err != nil {
		return nil, nil, err
	}
	txn, err := proposal.Endorse()
	if err != nil {
		return nil, nil, mapErr(err)
	}
	result := txn.Result()
	commit, err := txn.Submit()
	if err != nil {
		return nil, nil, mapErr(err)
	}
	status, err := commit.Status()
	if err != nil {
		return nil, nil, mapErr(err)
	}
	if !status.Successful {
		return nil, nil, fmt.Errorf("transaksi gagal di-commit (code=%d)", int32(status.Code))
	}
	proof := &Proof{TxID: commit.TransactionID(), BlockNumber: status.BlockNumber}
	if b, e := m.GetBlock(status.BlockNumber); e == nil {
		proof.BlockHash = b.HeaderHash
	}
	return result, proof, nil
}

// Evaluate — query (tidak mengubah ledger) sebagai identitas mspID.
func (m *Manager) Evaluate(mspID, fn string, args ...string) ([]byte, error) {
	ct, err := m.contract(mspID)
	if err != nil {
		return nil, err
	}
	res, err := ct.EvaluateTransaction(fn, args...)
	if err != nil {
		return nil, mapErr(err)
	}
	return res, nil
}

