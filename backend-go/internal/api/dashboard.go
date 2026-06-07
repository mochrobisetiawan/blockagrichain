package api

import (
	"encoding/json"
	"net/http"

	"blockagrichain/backend/internal/auth"
	"blockagrichain/backend/internal/chain"
	"blockagrichain/backend/internal/models"
)

const (
	ureaPriceIdr = 2250 // Rp/kg (≈ UREA_PRICE_PER_KG_CENTS/100)
	npkPriceIdr  = 2300
)

func (s *Server) dashboardStats(w http.ResponseWriter, r *http.Request) {
	p := auth.From(r.Context())

	var harvests []models.Harvest
	s.db.Preload("Land").Preload("Allocation").Find(&harvests)
	var allocations []models.Allocation
	s.db.Find(&allocations)
	var dists []models.DistributionOrder
	s.db.Find(&dists)
	var payments []models.Payment
	s.db.Find(&payments)

	count := func(items func(func(string))) map[string]int {
		m := map[string]int{}
		items(func(st string) { m[st]++ })
		return m
	}

	hStatus := count(func(add func(string)) {
		for _, h := range harvests {
			add(h.Status)
		}
	})
	var totalQty float64
	for _, h := range harvests {
		totalQty += h.QtyClaimedKg
	}

	var ureaSum, npkSum, orgSum, usedIdr float64
	for _, a := range allocations {
		ureaSum += a.UreaKg
		npkSum += a.NpkKg
		orgSum += a.OrganicKg
		usedIdr += a.UreaKg*ureaPriceIdr + a.NpkKg*npkPriceIdr
	}

	dStatus := count(func(add func(string)) {
		for _, d := range dists {
			add(d.Status)
		}
	})

	pStatus := count(func(add func(string)) {
		for _, p := range payments {
			add(p.Status)
		}
	})
	var totalDisbursed int64
	for _, p := range payments {
		if p.Status == models.PayDisbursed {
			totalDisbursed += p.AmountIdr
		}
	}

	// Sebaran per provinsi (peta GIS)
	type prov struct {
		Province string  `json:"province"`
		Harvests int     `json:"harvests"`
		UreaKg   float64 `json:"ureaKg"`
		NpkKg    float64 `json:"npkKg"`
	}
	provMap := map[string]*prov{}
	for _, h := range harvests {
		name := "—"
		if h.Land != nil {
			name = h.Land.Province
		}
		if provMap[name] == nil {
			provMap[name] = &prov{Province: name}
		}
		provMap[name].Harvests++
		if h.Allocation != nil {
			provMap[name].UreaKg += h.Allocation.UreaKg
			provMap[name].NpkKg += h.Allocation.NpkKg
		}
	}
	byProvince := []*prov{}
	for _, v := range provMap {
		byProvince = append(byProvince, v)
	}

	// Kebijakan aktif + cap anggaran (langsung dari ledger)
	var capIdr int64
	var policyName any
	if res, err := s.fab.Evaluate(p.MspID, "GetActivePolicy"); err == nil && len(res) > 0 && string(res) != "null" {
		var pol chain.PolicyRecord
		if json.Unmarshal(res, &pol) == nil {
			capIdr = pol.BudgetCapIDRCents / 100
			policyName = pol.PolicyName
		}
	}
	height, _ := s.fab.ChainHeight()

	s.json(w, 200, map[string]any{
		"harvests": map[string]any{"total": len(harvests), "pending": hStatus[models.HarvestPending],
			"verified": hStatus[models.HarvestVerified], "rejected": hStatus[models.HarvestRejected], "totalQtyKg": totalQty},
		"allocations": map[string]any{"count": len(allocations), "ureaKg": ureaSum, "npkKg": npkSum, "organicKg": orgSum},
		"distributions": map[string]any{"total": len(dists), "created": dStatus[models.DistCreated],
			"shipped": dStatus[models.DistShipped], "delivered": dStatus[models.DistDelivered], "confirmed": dStatus[models.DistConfirmed]},
		"payments": map[string]any{"requested": pStatus[models.PayRequested], "disbursed": pStatus[models.PayDisbursed],
			"rejected": pStatus[models.PayRejected], "totalDisbursedIdr": totalDisbursed},
		"budget":      map[string]any{"capIdr": capIdr, "usedIdr": int64(usedIdr), "activePolicy": policyName},
		"byProvince":  byProvince,
		"blockHeight": height,
	})
}
