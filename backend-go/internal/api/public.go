package api

import (
	"net"
	"net/http"
	"time"

	"blockagrichain/backend/internal/models"
)

// publicNetwork — GET /api/public/network (TANPA auth) untuk landing page.
// Status node NYATA (cek TCP ke tiap peer/orderer), tinggi blok, & statistik agregat.
func (s *Server) publicNetwork(w http.ResponseWriter, _ *http.Request) {
	type node struct {
		Name   string `json:"name"`
		Online bool   `json:"online"`
	}
	nodes := []node{}
	online := 0
	check := func(name, addr string) {
		ok := false
		if addr != "" {
			if c, err := net.DialTimeout("tcp", addr, 1200*time.Millisecond); err == nil {
				ok = true
				_ = c.Close()
			}
		}
		if ok {
			online++
		}
		nodes = append(nodes, node{Name: name, Online: ok})
	}
	check("Orderer", "orderer.blockagri.id:7050")
	labels := map[string]string{"PetaniMSP": "Peer Petani", "BulogMSP": "Peer Bulog",
		"KementanMSP": "Peer Kementan", "KemenkeuMSP": "Peer Kemenkeu", "PIHCMSP": "Peer PIHC"}
	for _, msp := range []string{"PetaniMSP", "BulogMSP", "KementanMSP", "KemenkeuMSP", "PIHCMSP"} {
		check(labels[msp], s.cfg.PeerEndpoints[msp])
	}

	height, herr := s.fab.ChainHeight()

	var farmers, harvests, verified, policies int64
	s.db.Model(&models.Farmer{}).Count(&farmers)
	s.db.Model(&models.Harvest{}).Count(&harvests)
	s.db.Model(&models.Harvest{}).Where("status = ?", models.HarvestVerified).Count(&verified)
	s.db.Model(&models.Policy{}).Where("status = ?", models.PolicyActive).Count(&policies)

	// Sebaran per wilayah (provinsi) untuk peta dashboard di landing.
	type region struct {
		Province string  `json:"province"`
		Farmers  int64   `json:"farmers"`
		Lat      float64 `json:"lat"`
		Lng      float64 `json:"lng"`
	}
	regions := []region{}
	s.db.Model(&models.FarmLand{}).
		Select("province, COUNT(DISTINCT farmer_id) AS farmers, AVG(gps_lat) AS lat, AVG(gps_lng) AS lng").
		Where("province <> '' AND gps_lat IS NOT NULL AND gps_lng IS NOT NULL").
		Group("province").Scan(&regions)

	s.json(w, 200, map[string]any{
		"fabricUp":    herr == nil,
		"blockHeight": height,
		"nodesOnline": online,
		"nodesTotal":  len(nodes),
		"nodes":       nodes,
		"regions":     regions,
		"stats": map[string]any{
			"farmers": farmers, "harvests": harvests, "verified": verified, "activePolicies": policies,
		},
	})
}
