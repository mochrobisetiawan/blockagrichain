package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"blockagrichain/backend/internal/auth"
	"blockagrichain/backend/internal/models"
)

func projectPayment(p *models.Payment) map[string]any {
	out := map[string]any{
		"id": p.ID, "amountIdr": p.AmountIdr, "status": p.Status, "kemenkeuRef": p.KemenkeuRef,
		"blockchainTxId": p.BlockchainTxID, "processedAt": p.ProcessedAt, "distribution": nil,
	}
	if p.DistributionOrder != nil {
		dist := map[string]any{"distributionChainId": p.DistributionOrder.DistributionChainID, "farmer": nil}
		if p.DistributionOrder.Allocation != nil && p.DistributionOrder.Allocation.Harvest != nil &&
			p.DistributionOrder.Allocation.Harvest.Farmer != nil {
			dist["farmer"] = p.DistributionOrder.Allocation.Harvest.Farmer.FullName
		}
		out["distribution"] = dist
	}
	return out
}

func (s *Server) listPayments(w http.ResponseWriter, _ *http.Request) {
	var list []models.Payment
	s.db.Preload("DistributionOrder.Allocation.Harvest.Farmer").Order("id desc").Find(&list)
	out := make([]map[string]any, 0, len(list))
	for i := range list {
		out = append(out, projectPayment(&list[i]))
	}
	s.json(w, 200, out)
}

func (s *Server) requestPayment(w http.ResponseWriter, r *http.Request) {
	p := auth.From(r.Context())
	var req struct {
		DistributionOrderID int64 `json:"distributionOrderId"`
		AmountIdr           int64 `json:"amountIdr"`
	}
	if err := decode(r, &req); err != nil {
		s.bad(w, "Body tidak valid")
		return
	}
	var order models.DistributionOrder
	if err := s.db.Preload("Payment").First(&order, req.DistributionOrderID).Error; err != nil {
		s.notFound(w, "Order distribusi tidak ditemukan")
		return
	}
	if order.Payment != nil {
		s.bad(w, "Klaim untuk distribusi ini sudah diajukan")
		return
	}
	if req.AmountIdr <= 0 {
		s.bad(w, "Nominal subsidi tidak valid")
		return
	}

	_, proof, err := s.fab.Submit(p.MspID, "RequestPayment", order.DistributionChainID, strconv.FormatInt(req.AmountIdr*100, 10))
	if err != nil {
		s.fail(w, err)
		return
	}
	tx := proof.TxID
	pay := models.Payment{DistributionOrderID: order.ID, AmountIdr: req.AmountIdr, Status: models.PayRequested, BlockchainTxID: &tx}
	s.db.Create(&pay)
	s.notify(models.RoleKemenkeu, "PaymentRequested", "Klaim subsidi masuk",
		"PIHC mengajukan klaim Rp "+strconv.FormatInt(req.AmountIdr, 10)+" untuk order "+order.DistributionChainID+".", tx, nil)

	s.db.Preload("DistributionOrder.Allocation.Harvest.Farmer").First(&pay, pay.ID)
	s.json(w, 200, map[string]any{"payment": projectPayment(&pay), "proof": proofOf(proof)})
}

func (s *Server) approvePayment(w http.ResponseWriter, r *http.Request) {
	p := auth.From(r.Context())
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	var req struct {
		KemenkeuRef string `json:"kemenkeuRef"`
	}
	_ = decode(r, &req)
	var pay models.Payment
	if err := s.db.Preload("DistributionOrder").First(&pay, id).Error; err != nil {
		s.notFound(w, "Pembayaran tidak ditemukan")
		return
	}
	refHash := auth.Sha256Hex(req.KemenkeuRef)
	_, proof, err := s.fab.Submit(p.MspID, "ApprovePayment", pay.DistributionOrder.DistributionChainID, refHash)
	if err != nil {
		s.fail(w, err)
		return
	}
	now := time.Now()
	pay.Status = models.PayDisbursed
	pay.KemenkeuRef = &req.KemenkeuRef
	pay.ProcessedAt = &now
	s.db.Save(&pay)
	s.notify(models.RolePihc, "PaymentDisbursed", "Subsidi dicairkan",
		"Klaim Rp "+strconv.FormatInt(pay.AmountIdr, 10)+" telah dicairkan Kemenkeu (ref "+req.KemenkeuRef+").", proof.TxID, nil)

	s.db.Preload("DistributionOrder.Allocation.Harvest.Farmer").First(&pay, pay.ID)
	s.json(w, 200, map[string]any{"payment": projectPayment(&pay), "proof": proofOf(proof)})
}

func (s *Server) rejectPayment(w http.ResponseWriter, r *http.Request) {
	p := auth.From(r.Context())
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	var req struct {
		Reason string `json:"reason"`
	}
	_ = decode(r, &req)
	var pay models.Payment
	if err := s.db.Preload("DistributionOrder").First(&pay, id).Error; err != nil {
		s.notFound(w, "Pembayaran tidak ditemukan")
		return
	}
	_, proof, err := s.fab.Submit(p.MspID, "RejectPayment", pay.DistributionOrder.DistributionChainID, req.Reason)
	if err != nil {
		s.fail(w, err)
		return
	}
	now := time.Now()
	pay.Status = models.PayRejected
	pay.ProcessedAt = &now
	s.db.Save(&pay)
	s.notify(models.RolePihc, "PaymentRejected", "Klaim ditolak",
		"Klaim Rp "+strconv.FormatInt(pay.AmountIdr, 10)+" ditolak Kemenkeu: "+req.Reason, proof.TxID, nil)

	s.db.Preload("DistributionOrder.Allocation.Harvest.Farmer").First(&pay, pay.ID)
	s.json(w, 200, map[string]any{"payment": projectPayment(&pay), "proof": proofOf(proof)})
}
