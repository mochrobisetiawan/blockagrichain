package api

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"blockagrichain/backend/internal/auth"
	"blockagrichain/backend/internal/chain"
	"blockagrichain/backend/internal/models"
)

func (s *Server) listPolicies(w http.ResponseWriter, _ *http.Request) {
	var list []models.Policy
	s.db.Order("id desc").Find(&list)
	s.json(w, 200, list)
}

func (s *Server) activePolicy(w http.ResponseWriter, r *http.Request) {
	p := auth.From(r.Context())
	res, err := s.fab.Evaluate(p.MspID, "GetActivePolicy")
	if err != nil {
		s.fail(w, err)
		return
	}
	if len(res) == 0 || string(res) == "null" {
		s.json(w, 200, nil)
		return
	}
	var pol chain.PolicyRecord
	_ = json.Unmarshal(res, &pol)
	s.json(w, 200, pol)
}

func (s *Server) proposePolicy(w http.ResponseWriter, r *http.Request) {
	p := auth.From(r.Context())
	var req struct {
		PolicyName    string  `json:"policyName"`
		UreaCoeff     float64 `json:"ureaCoeff"`
		NpkCoeff      float64 `json:"npkCoeff"`
		OrganicCoeff  float64 `json:"organicCoeff"`
		BudgetCapIdr  int64   `json:"budgetCapIdr"`
		EffectiveDate string  `json:"effectiveDate"` // "2006-01-02" atau RFC3339
	}
	if err := decode(r, &req); err != nil {
		s.bad(w, "Body tidak valid")
		return
	}
	if req.PolicyName == "" {
		s.bad(w, "Nama kebijakan wajib diisi")
		return
	}
	// Terima tanggal "2026-07-01" maupun RFC3339; fallback ke hari ini.
	eff := time.Now()
	for _, layout := range []string{"2006-01-02", time.RFC3339} {
		if t, e := time.Parse(layout, req.EffectiveDate); e == nil {
			eff = t
			break
		}
	}
	var cnt int64
	s.db.Model(&models.Policy{}).Count(&cnt)
	chainIDStr := fmt.Sprintf("POL-%d-%03d", eff.Year(), cnt+1)
	contentHash := auth.Sha256Hex(fmt.Sprintf("%s|%v|%v|%d", req.PolicyName, req.UreaCoeff, req.NpkCoeff, req.BudgetCapIdr))

	// koefisien kg/ton → x10000 (coeff4dp = kgPerTon * 10)
	urea4dp := strconv.FormatInt(int64(math.Round(req.UreaCoeff*10)), 10)
	npk4dp := strconv.FormatInt(int64(math.Round(req.NpkCoeff*10)), 10)
	org4dp := strconv.FormatInt(int64(math.Round(req.OrganicCoeff*10)), 10)

	_, proof, err := s.fab.Submit(p.MspID, "ProposePolicy",
		chainIDStr, req.PolicyName, contentHash, urea4dp, npk4dp, org4dp,
		strconv.FormatInt(req.BudgetCapIdr*100, 10), strconv.FormatInt(eff.Unix(), 10))
	if err != nil {
		s.fail(w, err)
		return
	}
	tx := proof.TxID
	pol := models.Policy{
		PolicyName: req.PolicyName, ProposedBy: &p.UserID,
		UreaCoeff: req.UreaCoeff, NpkCoeff: req.NpkCoeff, OrganicCoeff: req.OrganicCoeff,
		BudgetCapIdr: req.BudgetCapIdr, Status: models.PolicyPending,
		PolicyChainID: chainIDStr, BlockchainTxID: &tx, EffectiveDate: &eff,
	}
	s.db.Create(&pol)
	s.notify(models.RoleKemenkeu, "PolicyProposed", "Usulan kebijakan baru",
		"Kementan mengusulkan '"+req.PolicyName+"' — menunggu persetujuan anggaran.", tx, nil)
	s.json(w, 200, map[string]any{"policy": pol, "proof": proofOf(proof)})
}

func (s *Server) approvePolicy(w http.ResponseWriter, r *http.Request) {
	p := auth.From(r.Context())
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	var pol models.Policy
	if err := s.db.First(&pol, id).Error; err != nil {
		s.notFound(w, "Kebijakan tidak ditemukan")
		return
	}
	if pol.Status != models.PolicyPending {
		s.bad(w, "Kebijakan tidak dalam status PENDING_APPROVAL")
		return
	}
	_, proof, err := s.fab.Submit(p.MspID, "ApprovePolicy", pol.PolicyChainID)
	if err != nil {
		s.fail(w, err)
		return
	}
	s.db.Model(&models.Policy{}).Where("status = ?", models.PolicyActive).Update("status", models.PolicySuperseded)
	pol.Status = models.PolicyActive
	pol.ApprovedBy = &p.UserID
	s.db.Save(&pol)
	s.notify(models.RoleKementan, "PolicyActivated", "Kebijakan disetujui",
		"Kebijakan '"+pol.PolicyName+"' telah diaktifkan Kemenkeu.", proof.TxID, nil)
	s.json(w, 200, map[string]any{"policy": pol, "proof": proofOf(proof)})
}
