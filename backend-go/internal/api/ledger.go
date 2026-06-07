package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"blockagrichain/backend/internal/auth"
	"blockagrichain/backend/internal/chain"
	"blockagrichain/backend/internal/models"
)

// ledgerKey — bentuk key World State: TYPE_ID (mis. HARVEST_HRV-0001).
func ledgerKey(objectType, objectID string) string {
	return strings.ToUpper(objectType) + "_" + objectID
}

func (s *Server) ledgerBlocks(w http.ResponseWriter, r *http.Request) {
	take, _ := strconv.Atoi(r.URL.Query().Get("take"))
	blocks, err := s.fab.ListBlocks(take)
	if err != nil {
		s.fail(w, err)
		return
	}
	// Ratakan menjadi baris per-transaksi (sesuai tampilan Explorer).
	rows := []map[string]any{}
	for _, b := range blocks {
		if len(b.Txs) == 0 {
			rows = append(rows, map[string]any{"blockNumber": b.Number, "functionName": "(config)",
				"key": "", "mspId": "OrdererMSP", "clientId": "", "txId": "", "hash": b.HeaderHash, "prevHash": b.PreviousHash})
			continue
		}
		for _, t := range b.Txs {
			rows = append(rows, map[string]any{"blockNumber": b.Number, "functionName": t.FunctionName,
				"key": t.Key, "mspId": t.MspID, "clientId": "", "txId": t.TxID,
				"hash": b.HeaderHash, "prevHash": b.PreviousHash, "timestamp": t.Timestamp})
		}
	}
	s.json(w, 200, rows)
}

func (s *Server) ledgerEvents(w http.ResponseWriter, r *http.Request) {
	take, _ := strconv.Atoi(r.URL.Query().Get("take"))
	if take <= 0 || take > 200 {
		take = 50
	}
	var rows []models.LedgerEvent
	s.db.Order("id desc").Limit(take).Find(&rows)
	out := make([]map[string]any, 0, len(rows))
	for _, e := range rows {
		var payload any
		_ = json.Unmarshal([]byte(e.PayloadJSON), &payload)
		out = append(out, map[string]any{"eventName": e.EventName, "txId": e.TxID,
			"blockNumber": e.BlockNumber, "timestamp": e.CreatedAt, "payload": payload})
	}
	s.json(w, 200, out)
}

func (s *Server) ledgerHistory(w http.ResponseWriter, r *http.Request) {
	p := auth.From(r.Context())
	key := ledgerKey(chi.URLParam(r, "objectType"), chi.URLParam(r, "objectId"))
	res, err := s.fab.Evaluate(p.MspID, "GetTransactionHistory", key)
	if err != nil {
		s.fail(w, err)
		return
	}
	var hist []chain.HistoryEntry
	_ = json.Unmarshal(res, &hist)
	items := make([]map[string]any, 0, len(hist))
	for _, h := range hist {
		var data any
		if h.Value != "" {
			_ = json.Unmarshal([]byte(h.Value), &data)
		}
		items = append(items, map[string]any{"txId": h.TxID, "timestamp": h.Timestamp,
			"isDelete": h.IsDelete, "data": data})
	}
	s.json(w, 200, map[string]any{"key": key, "history": items})
}

// rawState — ambil JSON state via chaincode GetState.
// Toleran terhadap dua bentuk serialisasi contractapi: objek mentah ({..}) atau string ber-quote ("{..}").
func (s *Server) rawState(mspID, key string) (map[string]any, error) {
	res, err := s.fab.Evaluate(mspID, "GetState", key)
	if err != nil {
		return nil, err
	}
	if len(res) == 0 || string(res) == "null" || string(res) == "\"\"" {
		return nil, nil
	}
	// (1) coba langsung sebagai objek JSON
	var doc map[string]any
	if json.Unmarshal(res, &doc) == nil && len(doc) > 0 {
		return doc, nil
	}
	// (2) mungkin string ber-quote berisi JSON
	var inner string
	if json.Unmarshal(res, &inner) == nil && inner != "" {
		if json.Unmarshal([]byte(inner), &doc) == nil {
			return doc, nil
		}
	}
	return nil, nil
}

func (s *Server) ledgerState(w http.ResponseWriter, r *http.Request) {
	p := auth.From(r.Context())
	key := ledgerKey(chi.URLParam(r, "objectType"), chi.URLParam(r, "objectId"))
	doc, err := s.rawState(p.MspID, key)
	if err != nil {
		s.fail(w, err)
		return
	}
	if doc == nil {
		s.notFound(w, "State tidak ditemukan")
		return
	}
	s.json(w, 200, doc)
}

func (s *Server) verifyHash(w http.ResponseWriter, r *http.Request) {
	p := auth.From(r.Context())
	var req struct {
		ObjectType string `json:"objectType"`
		ObjectID   string `json:"objectId"`
		Hash       string `json:"hash"`
	}
	if err := decode(r, &req); err != nil {
		s.bad(w, "Body tidak valid")
		return
	}
	doc, err := s.rawState(p.MspID, ledgerKey(req.ObjectType, req.ObjectID))
	if err != nil {
		s.fail(w, err)
		return
	}
	if doc == nil {
		s.notFound(w, "Objek tidak ditemukan di ledger")
		return
	}
	field := map[string]string{
		"HARVEST": "harvestDocHash", "DIST": "deliveryProofHash",
		"VERIF": "ocrDataHash", "POLICY": "policyContentHash",
	}[strings.ToUpper(req.ObjectType)]
	onChain, _ := doc[field].(string)
	match := onChain != "" && strings.EqualFold(onChain, req.Hash)
	s.json(w, 200, map[string]any{"match": match, "onChainHash": onChain, "submittedHash": req.Hash})
}

func (s *Server) ledgerIntegrity(w http.ResponseWriter, _ *http.Request) {
	res, err := s.fab.Integrity()
	if err != nil {
		s.fail(w, err)
		return
	}
	s.json(w, 200, res)
}
