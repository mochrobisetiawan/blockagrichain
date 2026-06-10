package api

import (
	"math"
	"net/http"
	"strconv"

	"blockagrichain/backend/internal/auth"
	"blockagrichain/backend/internal/chain"
	"blockagrichain/backend/internal/models"
)

func (s *Server) submitVerification(w http.ResponseWriter, r *http.Request) {
	p := auth.From(r.Context())
	var req struct {
		HarvestID        int64   `json:"harvestId"`
		MeasuredWeightKg float64 `json:"measuredWeightKg"`
		OcrWeightRaw     *string `json:"ocrWeightRaw"`
		Decision         string  `json:"decision"`
		RejectReason     string  `json:"rejectReason"`
		HsmSignature     *string `json:"hsmSignature"`
	}
	if err := decode(r, &req); err != nil {
		s.bad(w, "Body tidak valid")
		return
	}
	if req.Decision == "REJECTED" && req.RejectReason == "" {
		s.bad(w, "Alasan penolakan wajib diisi")
		return
	}

	var h models.Harvest
	if err := s.db.Preload("Farmer").First(&h, req.HarvestID).Error; err != nil {
		s.notFound(w, "Laporan panen tidak ditemukan")
		return
	}
	if h.Status != models.HarvestPending {
		s.bad(w, "Laporan sudah diproses: "+h.Status)
		return
	}
	if req.Decision != "APPROVED" && req.Decision != "REJECTED" {
		s.bad(w, "Decision harus APPROVED atau REJECTED")
		return
	}

	claimedG := int64(h.QtyClaimedKg * 1000)
	measuredG := int64(req.MeasuredWeightKg * 1000)
	delta2dp := int64(math.Round(float64(measuredG-claimedG) / float64(claimedG) * 10000))

	ocrRaw := strconv.FormatFloat(req.MeasuredWeightKg, 'f', -1, 64)
	if req.OcrWeightRaw != nil {
		ocrRaw = *req.OcrWeightRaw
	}
	ocrHash := auth.Sha256Hex(ocrRaw)
	hsmSig := "HSM:" + auth.Sha256Hex(h.HarvestChainID+"|"+p.FabricClientID+"|"+req.Decision+"|"+strconv.FormatInt(measuredG, 10))[:40]
	if req.HsmSignature != nil && *req.HsmSignature != "" {
		hsmSig = *req.HsmSignature
	}

	_, proof, err := s.fab.Submit(p.MspID, "SubmitVerification",
		h.HarvestChainID, strconv.FormatInt(measuredG, 10), ocrHash,
		strconv.FormatInt(delta2dp, 10), req.Decision, hsmSig)
	if err != nil {
		s.fail(w, err)
		return
	}
	tx := proof.TxID

	status := models.HarvestVerified
	vstatus := "APPROVED"
	if req.Decision == "REJECTED" {
		status = models.HarvestRejected
		vstatus = "REJECTED"
	}
	verif := models.Verification{
		HarvestRecordID: h.ID, BulogOfficerID: p.UserID, MeasuredWeightKg: req.MeasuredWeightKg,
		OcrWeightRaw: req.OcrWeightRaw, DeltaPercent: float64(delta2dp) / 100, Status: vstatus, BlockchainTxID: &tx,
	}
	if req.Decision == "REJECTED" && req.RejectReason != "" {
		verif.RejectReason = &req.RejectReason
	}
	s.db.Create(&verif)
	s.db.Model(&models.Harvest{}).Where("id = ?", h.ID).Update("status", status)

	var farmerUserID *int64
	if h.Farmer != nil {
		farmerUserID = &h.Farmer.UserID
	}

	if req.Decision == "APPROVED" {
		var alloc chain.AllocationRecord
		if err := s.eval(p.MspID, &alloc, "GetAllocation", h.HarvestChainID); err == nil && alloc.HarvestID != "" {
			s.db.Create(&models.Allocation{
				HarvestRecordID: h.ID,
				UreaKg:          float64(alloc.UreaG) / 1000, NpkKg: float64(alloc.NPKG) / 1000, OrganicKg: float64(alloc.OrganicG) / 1000,
				FormulaVersion: alloc.FormulaVersion, BlockchainTxID: &tx,
			})
		}
		s.notify(models.RoleFarmer, "AllocationCalculated", "Alokasi pupuk terbit",
			"Laporan "+h.HarvestChainID+" terverifikasi. Kuota subsidi dihitung otomatis.", tx, farmerUserID)
		fullName := ""
		if h.Farmer != nil {
			fullName = h.Farmer.FullName
		}
		s.notify(models.RolePihc, "AllocationCalculated", "Alokasi siap distribusi",
			"Alokasi pupuk untuk "+fullName+" siap didistribusikan.", tx, nil)
	} else {
		s.notify(models.RoleFarmer, "VerificationCompleted", "Laporan ditolak",
			"Laporan "+h.HarvestChainID+" ditolak Bulog. Alasan: "+req.RejectReason, tx, farmerUserID)
	}

	s.json(w, 200, map[string]any{
		"verification": map[string]any{"id": verif.ID, "status": verif.Status,
			"measuredWeightKg": verif.MeasuredWeightKg, "deltaPercent": verif.DeltaPercent, "blockchainTxId": verif.BlockchainTxID},
		"proof": proofOf(proof),
	})
}
