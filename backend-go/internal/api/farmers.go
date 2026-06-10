package api

import (
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"blockagrichain/backend/internal/auth"
	"blockagrichain/backend/internal/chain"
	"blockagrichain/backend/internal/models"
)

// updateFarmerMe — PATCH /farmers/me (petani edit profil sendiri, off-chain).
func (s *Server) updateFarmerMe(w http.ResponseWriter, r *http.Request) {
	p := auth.From(r.Context())
	var f models.Farmer
	if err := s.db.Where("user_id = ?", p.UserID).First(&f).Error; err != nil {
		s.notFound(w, "Profil petani tidak ditemukan")
		return
	}
	var req struct {
		FullName      string `json:"fullName"`
		FarmerGroup   string `json:"farmerGroup"`
		Phone         string `json:"phone"`
		AddressDetail string `json:"addressDetail"`
	}
	if err := decode(r, &req); err != nil {
		s.bad(w, "Body tidak valid")
		return
	}
	if req.FullName != "" {
		f.FullName = req.FullName
	}
	if req.FarmerGroup != "" {
		f.FarmerGroup = &req.FarmerGroup
	}
	if req.Phone != "" {
		f.Phone = &req.Phone
	}
	if req.AddressDetail != "" {
		f.AddressDetail = &req.AddressDetail
	}
	s.db.Save(&f)
	s.json(w, 200, map[string]any{"ok": true})
}

// changePassword — PATCH /farmers/me/password (petani ganti kata sandi sendiri).
func (s *Server) changePassword(w http.ResponseWriter, r *http.Request) {
	p := auth.From(r.Context())
	var req struct {
		OldPassword string `json:"oldPassword"`
		NewPassword string `json:"newPassword"`
	}
	if err := decode(r, &req); err != nil || len(req.NewPassword) < 6 {
		s.bad(w, "Kata sandi baru minimal 6 karakter")
		return
	}
	var u models.User
	if err := s.db.First(&u, p.UserID).Error; err != nil {
		s.notFound(w, "Pengguna tidak ditemukan")
		return
	}
	if !auth.VerifyPassword(u.PasswordHash, req.OldPassword) {
		s.bad(w, "Kata sandi lama salah")
		return
	}
	u.PasswordHash = auth.HashPassword(req.NewPassword)
	s.db.Save(&u)
	s.json(w, 200, map[string]any{"ok": true})
}

// addLand — POST /farmers/me/lands (petani tambah lahan, off-chain).
func (s *Server) addLand(w http.ResponseWriter, r *http.Request) {
	p := auth.From(r.Context())
	var f models.Farmer
	if err := s.db.Where("user_id = ?", p.UserID).First(&f).Error; err != nil {
		s.notFound(w, "Profil petani tidak ditemukan")
		return
	}
	var req struct {
		Village    string   `json:"village"`
		District   string   `json:"district"`
		City       string   `json:"city"`
		Province   string   `json:"province"`
		LandAreaHa float64  `json:"landAreaHa"`
		GpsLat     *float64 `json:"gpsLat"`
		GpsLng     *float64 `json:"gpsLng"`
		IsPrimary  bool     `json:"isPrimary"`
	}
	if err := decode(r, &req); err != nil || req.Village == "" || req.LandAreaHa <= 0 {
		s.bad(w, "Data lahan tidak valid (desa & luas wajib)")
		return
	}
	land := models.FarmLand{
		FarmerID: f.ID, Village: req.Village, District: req.District, City: req.City, Province: req.Province,
		LandAreaHa: req.LandAreaHa, GpsLat: req.GpsLat, GpsLng: req.GpsLng, IsPrimary: req.IsPrimary,
	}
	if err := s.db.Create(&land).Error; err != nil {
		s.fail(w, err)
		return
	}
	if req.IsPrimary {
		s.db.Model(&models.FarmLand{}).Where("farmer_id = ? AND id <> ?", f.ID, land.ID).Update("is_primary", false)
	}
	s.json(w, 200, map[string]any{"id": land.ID})
}

// createFarmer — POST /farmers (Kementan/Bulog daftarkan petani baru) + on-chain RegisterFarmer.
func (s *Server) createFarmer(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username    string   `json:"username"`
		Password    string   `json:"password"`
		FullName    string   `json:"fullName"`
		Nik         string   `json:"nik"`
		FarmerGroup string   `json:"farmerGroup"`
		Phone       string   `json:"phone"`
		Village     string   `json:"village"`
		District    string   `json:"district"`
		City        string   `json:"city"`
		Province    string   `json:"province"`
		LandAreaHa  float64  `json:"landAreaHa"`
		GpsLat      *float64 `json:"gpsLat"`
		GpsLng      *float64 `json:"gpsLng"`
	}
	if err := decode(r, &req); err != nil || req.Username == "" || req.FullName == "" || req.Nik == "" {
		s.bad(w, "username, fullName, dan NIK wajib diisi")
		return
	}
	var dup int64
	s.db.Model(&models.User{}).Where("username = ?", req.Username).Count(&dup)
	if dup > 0 {
		s.bad(w, "Username sudah dipakai")
		return
	}
	cn, err := s.fab.ClientCN(models.MSPForRole(models.RoleFarmer))
	if err != nil {
		s.fail(w, err)
		return
	}
	pw := req.Password
	if pw == "" {
		pw = "password123"
	}
	u := models.User{
		Username: req.Username, Email: req.Username + "@blockagrichain.id",
		PasswordHash: auth.HashPassword(pw), Role: models.RoleFarmer,
		MspID: models.MSPForRole(models.RoleFarmer), FabricClientID: cn, IsActive: true, CreatedAt: time.Now(),
	}
	if err := s.db.Create(&u).Error; err != nil {
		s.fail(w, err)
		return
	}
	chainID := fmt.Sprintf("F-%04d", u.ID)
	f := models.Farmer{UserID: u.ID, Nik: req.Nik, FullName: req.FullName, FarmerChainID: chainID}
	if req.FarmerGroup != "" {
		f.FarmerGroup = &req.FarmerGroup
	}
	if req.Phone != "" {
		f.Phone = &req.Phone
	}
	s.db.Create(&f)
	if req.Village != "" {
		s.db.Create(&models.FarmLand{FarmerID: f.ID, Village: req.Village, District: req.District, City: req.City,
			Province: req.Province, LandAreaHa: req.LandAreaHa, GpsLat: req.GpsLat, GpsLng: req.GpsLng, IsPrimary: true})
	}
	// On-chain: registrasi petani (submit memakai identitas PetaniMSP yang dipegang server).
	landM2 := strconv.Itoa(int(req.LandAreaHa * 10000))
	region := req.Province
	if region == "" {
		region = "-"
	}
	_, proof, err := s.fab.Submit(models.MSPForRole(models.RoleFarmer), "RegisterFarmer",
		chainID, cn, auth.Sha256Hex(req.Nik), landM2, region)
	if err != nil {
		s.fail(w, err)
		return
	}
	tx := proof.TxID
	s.json(w, 200, map[string]any{"id": f.ID, "username": u.Username, "farmerChainId": chainID,
		"txId": tx, "proof": proofOf(proof)})
}

func (s *Server) farmerMe(w http.ResponseWriter, r *http.Request) {
	p := auth.From(r.Context())
	var f models.Farmer
	if err := s.db.Preload("FarmLands").Where("user_id = ?", p.UserID).First(&f).Error; err != nil {
		s.notFound(w, "Profil petani tidak ditemukan")
		return
	}
	lands := make([]map[string]any, 0, len(f.FarmLands))
	for _, l := range f.FarmLands {
		lands = append(lands, map[string]any{"id": l.ID, "village": l.Village, "district": l.District, "city": l.City,
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
