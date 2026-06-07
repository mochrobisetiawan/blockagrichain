package api

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"blockagrichain/backend/internal/auth"
	"blockagrichain/backend/internal/chain"
	"blockagrichain/backend/internal/models"
)

func (s *Server) farmerMe(w http.ResponseWriter, r *http.Request) {
	p := auth.From(r.Context())
	var f models.Farmer
	if err := s.db.Preload("FarmLands").Where("user_id = ?", p.UserID).First(&f).Error; err != nil {
		s.notFound(w, "Profil petani tidak ditemukan")
		return
	}
	lands := make([]map[string]any, 0, len(f.FarmLands))
	for _, l := range f.FarmLands {
		lands = append(lands, map[string]any{"id": l.ID, "village": l.Village, "district": l.District,
			"province": l.Province, "landAreaHa": l.LandAreaHa, "gpsLat": l.GpsLat, "gpsLng": l.GpsLng, "isPrimary": l.IsPrimary})
	}
	var onChain chain.FarmerRecord
	_ = s.eval(p.MspID, &onChain, "GetFarmer", f.FarmerChainID)
	s.json(w, 200, map[string]any{
		"id": f.ID, "fullName": f.FullName, "farmerGroup": f.FarmerGroup, "phone": f.Phone,
		"farmerChainId": f.FarmerChainID, "profilePhotoUrl": f.ProfilePhotoURL, "lands": lands, "onChain": onChain,
	})
}

func (s *Server) listFarmers(w http.ResponseWriter, _ *http.Request) {
	var list []models.Farmer
	s.db.Preload("User").Preload("FarmLands").Find(&list)
	out := make([]map[string]any, 0, len(list))
	for i := range list {
		f := &list[i]
		province := ""
		for _, l := range f.FarmLands {
			if l.IsPrimary {
				province = l.Province
			}
		}
		active := false
		if f.User != nil {
			active = f.User.IsActive
		}
		out = append(out, map[string]any{"id": f.ID, "fullName": f.FullName, "farmerGroup": f.FarmerGroup,
			"phone": f.Phone, "farmerChainId": f.FarmerChainID, "isActive": active, "province": province})
	}
	s.json(w, 200, out)
}

func (s *Server) disableFarmer(w http.ResponseWriter, r *http.Request) {
	p := auth.From(r.Context())
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	var f models.Farmer
	if err := s.db.Preload("User").First(&f, id).Error; err != nil {
		s.notFound(w, "Petani tidak ditemukan")
		return
	}
	_, proof, err := s.fab.Submit(p.MspID, "DisableFarmer", f.FarmerChainID)
	if err != nil {
		s.fail(w, err)
		return
	}
	if f.User != nil {
		s.db.Model(&models.User{}).Where("id = ?", f.User.ID).Update("is_active", false)
	}
	s.json(w, 200, map[string]any{"proof": proofOf(proof)})
}
