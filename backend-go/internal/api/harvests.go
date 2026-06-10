package api

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"blockagrichain/backend/internal/auth"
	"blockagrichain/backend/internal/chain"
	"blockagrichain/backend/internal/models"
)

func projectHarvest(h *models.Harvest) map[string]any {
	out := map[string]any{
		"id": h.ID, "harvestChainId": h.HarvestChainID, "cropType": h.CropType,
		"qtyClaimedKg": h.QtyClaimedKg, "status": h.Status, "harvestDocHash": h.HarvestDocHash,
		"harvestPhotoUrl": h.HarvestPhotoURL, "blockchainTxId": h.BlockchainTxID, "submittedAt": h.SubmittedAt,
		"iotImageUrl": h.IoTImageURL, "iotWeightKg": h.IoTWeightKg, "iotOcrRaw": h.IoTOcrRaw, "iotDeviceId": h.IoTDeviceID,
		"bulogPhotoUrl": h.BulogPhotoURL,
		"farmer": nil, "land": nil, "verification": nil, "allocation": nil,
	}
	if h.Farmer != nil {
		out["farmer"] = map[string]any{"fullName": h.Farmer.FullName, "farmerGroup": h.Farmer.FarmerGroup, "farmerChainId": h.Farmer.FarmerChainID}
	}
	if h.Land != nil {
		out["land"] = map[string]any{"village": h.Land.Village, "district": h.Land.District, "city": h.Land.City,
			"province": h.Land.Province, "landAreaHa": h.Land.LandAreaHa, "gpsLat": h.Land.GpsLat, "gpsLng": h.Land.GpsLng}
	}
	if h.Verification != nil {
		out["verification"] = map[string]any{"measuredWeightKg": h.Verification.MeasuredWeightKg,
			"deltaPercent": h.Verification.DeltaPercent, "status": h.Verification.Status, "verifiedAt": h.Verification.VerifiedAt}
	}
	if h.Allocation != nil {
		out["allocation"] = map[string]any{"ureaKg": h.Allocation.UreaKg, "npkKg": h.Allocation.NpkKg,
			"organicKg": h.Allocation.OrganicKg, "blockchainTxId": h.Allocation.BlockchainTxID}
	}
	return out
}

func (s *Server) listHarvests(w http.ResponseWriter, r *http.Request) {
	p := auth.From(r.Context())
	q := s.db.Preload("Farmer").Preload("Land").Preload("Verification").Preload("Allocation").
		Order("submitted_at desc")
	if p.Role == models.RoleFarmer {
		var f models.Farmer
		if err := s.db.Where("user_id = ?", p.UserID).First(&f).Error; err != nil {
			s.json(w, 200, []any{})
			return
		}
		q = q.Where("farmer_id = ?", f.ID)
	}
	var list []models.Harvest
	q.Find(&list)
	out := make([]map[string]any, 0, len(list))
	for i := range list {
		out = append(out, projectHarvest(&list[i]))
	}
	s.json(w, 200, out)
}

func (s *Server) pendingHarvests(w http.ResponseWriter, _ *http.Request) {
	var list []models.Harvest
	s.db.Preload("Farmer").Preload("Land").
		Where("status = ?", models.HarvestPending).Order("submitted_at asc").Find(&list)
	out := make([]map[string]any, 0, len(list))
	for i := range list {
		out = append(out, projectHarvest(&list[i]))
	}
	s.json(w, 200, out)
}

func (s *Server) getHarvest(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	var h models.Harvest
	if err := s.db.Preload("Farmer").Preload("Land").Preload("Verification").Preload("Allocation").
		First(&h, id).Error; err != nil {
		s.notFound(w, "Panen tidak ditemukan")
		return
	}
	p := auth.From(r.Context())
	var onChain chain.HarvestRecord
	_ = s.eval(p.MspID, &onChain, "GetHarvestById", h.HarvestChainID)
	s.json(w, 200, map[string]any{"offChain": projectHarvest(&h), "onChain": onChain})
}

func (s *Server) submitHarvest(w http.ResponseWriter, r *http.Request) {
	p := auth.From(r.Context())
	var req struct {
		LandID          int64   `json:"landId"`
		CropType        string  `json:"cropType"`
		QtyClaimedKg    float64 `json:"qtyClaimedKg"`
		HarvestDocHash  *string `json:"harvestDocHash"`
		HarvestPhotoURL *string `json:"harvestPhotoUrl"`
	}
	if err := decode(r, &req); err != nil {
		s.bad(w, "Body tidak valid")
		return
	}

	var farmer models.Farmer
	if err := s.db.Preload("FarmLands").Where("user_id = ?", p.UserID).First(&farmer).Error; err != nil {
		s.bad(w, "Profil petani tidak ditemukan")
		return
	}
	var land *models.FarmLand
	for i := range farmer.FarmLands {
		if farmer.FarmLands[i].ID == req.LandID {
			land = &farmer.FarmLands[i]
		}
	}
	if land == nil {
		s.bad(w, "Lahan tidak valid")
		return
	}
	if req.QtyClaimedKg <= 0 {
		s.bad(w, "Kuantitas harus > 0")
		return
	}

	var cnt int64
	s.db.Model(&models.Harvest{}).Count(&cnt)
	harvestChainID := chainID("HRV", cnt+1)

	photo := ""
	if req.HarvestPhotoURL != nil {
		photo = *req.HarvestPhotoURL
	}
	docHash := auth.Sha256Hex(harvestChainID + "|" + photo + "|" + strconv.FormatFloat(req.QtyClaimedKg, 'f', -1, 64))
	if req.HarvestDocHash != nil && *req.HarvestDocHash != "" {
		docHash = *req.HarvestDocHash
	}

	qtyG := strconv.FormatInt(int64(req.QtyClaimedKg*1000), 10)
	latE7 := strconv.FormatInt(int64(deref(land.GpsLat)*10_000_000), 10)
	lngE7 := strconv.FormatInt(int64(deref(land.GpsLng)*10_000_000), 10)

	_, proof, err := s.fab.Submit(p.MspID, "SubmitHarvest",
		harvestChainID, farmer.FarmerChainID, req.CropType, qtyG, docHash, latE7, lngE7)
	if err != nil {
		s.fail(w, err)
		return
	}

	tx := proof.TxID
	h := models.Harvest{
		FarmerID: farmer.ID, LandID: land.ID, CropType: req.CropType, QtyClaimedKg: req.QtyClaimedKg,
		HarvestPhotoURL: req.HarvestPhotoURL, HarvestDocHash: docHash, Status: models.HarvestPending,
		HarvestChainID: harvestChainID, BlockchainTxID: &tx,
	}
	s.db.Create(&h)
	s.notify(models.RoleBulog, "HarvestSubmitted", "Laporan panen baru",
		farmer.FullName+" melaporkan "+req.CropType+" — menunggu verifikasi fisik.", tx, nil)

	s.json(w, 200, map[string]any{"harvest": projectHarvest(&h), "proof": proofOf(proof)})
}

// eval — query chaincode lalu unmarshal ke dst. nil/empty → tetap dst kosong.
func (s *Server) eval(mspID string, dst any, fn string, args ...string) error {
	res, err := s.fab.Evaluate(mspID, fn, args...)
	if err != nil {
		return err
	}
	if len(res) == 0 || string(res) == "null" {
		return nil
	}
	return json.Unmarshal(res, dst)
}

func deref(f *float64) float64 {
	if f == nil {
		return 0
	}
	return *f
}
