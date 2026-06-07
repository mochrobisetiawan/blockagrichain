package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"blockagrichain/backend/internal/auth"
	"blockagrichain/backend/internal/models"
)

func projectDistribution(d *models.DistributionOrder) map[string]any {
	out := map[string]any{
		"id": d.ID, "distributionChainId": d.DistributionChainID, "status": d.Status,
		"scheduledDate": d.ScheduledDate, "actualDate": d.ActualDate,
		"deliveryPhotoUrl": d.DeliveryPhotoURL, "blockchainTxId": d.BlockchainTxID,
		"allocation": nil, "farmer": nil, "payment": nil,
	}
	if d.Allocation != nil {
		out["allocation"] = map[string]any{"ureaKg": d.Allocation.UreaKg, "npkKg": d.Allocation.NpkKg, "organicKg": d.Allocation.OrganicKg}
		if d.Allocation.Harvest != nil && d.Allocation.Harvest.Farmer != nil {
			f := d.Allocation.Harvest.Farmer
			out["farmer"] = map[string]any{"fullName": f.FullName, "farmerChainId": f.FarmerChainID}
		}
	}
	if d.Payment != nil {
		out["payment"] = map[string]any{"id": d.Payment.ID, "amountIdr": d.Payment.AmountIdr, "status": d.Payment.Status}
	}
	return out
}

func (s *Server) listDistributions(w http.ResponseWriter, r *http.Request) {
	p := auth.From(r.Context())
	var list []models.DistributionOrder
	s.db.Preload("Allocation.Harvest.Farmer").Preload("Payment").Order("id desc").Find(&list)
	out := make([]map[string]any, 0, len(list))
	for i := range list {
		d := &list[i]
		if p.Role == models.RoleFarmer {
			if d.Allocation == nil || d.Allocation.Harvest == nil || d.Allocation.Harvest.Farmer == nil ||
				d.Allocation.Harvest.Farmer.UserID != p.UserID {
				continue
			}
		}
		out = append(out, projectDistribution(d))
	}
	s.json(w, 200, out)
}

func (s *Server) readyAllocations(w http.ResponseWriter, _ *http.Request) {
	var list []models.Allocation
	s.db.Preload("Harvest.Farmer").Preload("DistributionOrder").Find(&list)
	out := []map[string]any{}
	for i := range list {
		a := &list[i]
		if a.DistributionOrder != nil {
			continue
		}
		row := map[string]any{"id": a.ID, "ureaKg": a.UreaKg, "npkKg": a.NpkKg, "organicKg": a.OrganicKg, "blockchainTxId": a.BlockchainTxID}
		if a.Harvest != nil {
			row["harvest"] = map[string]any{"harvestChainId": a.Harvest.HarvestChainID, "cropType": a.Harvest.CropType, "qtyClaimedKg": a.Harvest.QtyClaimedKg}
			if a.Harvest.Farmer != nil {
				row["farmer"] = map[string]any{"fullName": a.Harvest.Farmer.FullName, "farmerChainId": a.Harvest.Farmer.FarmerChainID}
			}
		}
		out = append(out, row)
	}
	s.json(w, 200, out)
}

func (s *Server) createDistribution(w http.ResponseWriter, r *http.Request) {
	p := auth.From(r.Context())
	var req struct {
		AllocationID  int64      `json:"allocationId"`
		ScheduledDate *time.Time `json:"scheduledDate"`
	}
	if err := decode(r, &req); err != nil {
		s.bad(w, "Body tidak valid")
		return
	}
	var alloc models.Allocation
	if err := s.db.Preload("Harvest.Farmer.User").Preload("DistributionOrder").First(&alloc, req.AllocationID).Error; err != nil {
		s.notFound(w, "Alokasi tidak ditemukan")
		return
	}
	if alloc.DistributionOrder != nil {
		s.bad(w, "Distribusi untuk alokasi ini sudah dibuat")
		return
	}
	if alloc.Harvest == nil || alloc.Harvest.Farmer == nil || alloc.Harvest.Farmer.User == nil {
		s.bad(w, "Data petani alokasi tidak lengkap")
		return
	}
	farmerFabricID := alloc.Harvest.Farmer.User.FabricClientID

	var cnt int64
	s.db.Model(&models.DistributionOrder{}).Count(&cnt)
	distChainID := chainID("DO", cnt+1)

	// AllocationID on-chain = HarvestChainID (key ALLOC_{harvestId}).
	_, proof, err := s.fab.Submit(p.MspID, "CreateDistribution", distChainID, alloc.Harvest.HarvestChainID, farmerFabricID)
	if err != nil {
		s.fail(w, err)
		return
	}
	tx := proof.TxID
	order := models.DistributionOrder{
		AllocationID: alloc.ID, PihcAgentID: p.UserID, Status: models.DistCreated,
		DistributionChainID: distChainID, BlockchainTxID: &tx, ScheduledDate: req.ScheduledDate,
	}
	s.db.Create(&order)
	uid := alloc.Harvest.Farmer.UserID
	s.notify(models.RoleFarmer, "DistributionCreated", "Distribusi pupuk dibuat",
		"PIHC membuat order distribusi "+distChainID+" untuk Anda.", tx, &uid)

	s.db.Preload("Allocation.Harvest.Farmer").Preload("Payment").First(&order, order.ID)
	s.json(w, 200, map[string]any{"order": projectDistribution(&order), "proof": proofOf(proof)})
}

func (s *Server) updateDistributionStatus(w http.ResponseWriter, r *http.Request) {
	p := auth.From(r.Context())
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	var req struct {
		NewStatus        string  `json:"newStatus"`
		DeliveryPhotoURL *string `json:"deliveryPhotoUrl"`
	}
	if err := decode(r, &req); err != nil {
		s.bad(w, "Body tidak valid")
		return
	}
	var order models.DistributionOrder
	if err := s.db.Preload("Allocation.Harvest.Farmer").First(&order, id).Error; err != nil {
		s.notFound(w, "Order tidak ditemukan")
		return
	}

	proofHash := ""
	if req.DeliveryPhotoURL != nil && *req.DeliveryPhotoURL != "" {
		proofHash = auth.Sha256Hex(*req.DeliveryPhotoURL)
	}

	_, proof, err := s.fab.Submit(p.MspID, "UpdateDistributionStatus", order.DistributionChainID, req.NewStatus, proofHash)
	if err != nil {
		s.fail(w, err)
		return
	}
	tx := proof.TxID

	order.Status = req.NewStatus
	if req.NewStatus == models.DistDelivered {
		order.DeliveryPhotoURL = req.DeliveryPhotoURL
		now := time.Now()
		order.ActualDate = &now
	}
	s.db.Save(&order)

	var farmerUserID *int64
	if order.Allocation != nil && order.Allocation.Harvest != nil && order.Allocation.Harvest.Farmer != nil {
		farmerUserID = &order.Allocation.Harvest.Farmer.UserID
	}
	switch req.NewStatus {
	case models.DistShipped:
		s.notify(models.RoleFarmer, "DistributionStatusUpdated", "Pupuk dikirim",
			"Order "+order.DistributionChainID+" sedang dalam pengiriman.", tx, farmerUserID)
	case models.DistConfirmed:
		s.notify(models.RolePihc, "DistributionStatusUpdated", "Penerimaan dikonfirmasi",
			"Petani mengonfirmasi order "+order.DistributionChainID+". Klaim subsidi dapat diajukan.", tx, nil)
	}

	s.json(w, 200, map[string]any{"order": projectDistribution(&order), "proof": proofOf(proof)})
}
