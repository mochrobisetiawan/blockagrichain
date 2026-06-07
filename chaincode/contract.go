package main

import (
	"encoding/json"
	"fmt"
	"math"

	"github.com/hyperledger/fabric-contract-api-go/contractapi"
)

// BlockAgriContract — implementasi seluruh fungsi smart contract DPPL bab V.
// Tiap fungsi mengikuti 4 tahap: (1) Validasi MSP, (2) Validasi Input,
// (3) Logika Bisnis, (4) Commit ke Ledger & Emit Event.
type BlockAgriContract struct {
	contractapi.Contract
}

// ───────────────────────── Helper deterministik ─────────────────────────

// txTime — timestamp transaksi (Unix detik). WAJIB pakai GetTxTimestamp agar
// deterministik di semua endorser (time.Now() akan memecah endorsement).
func txTime(ctx contractapi.TransactionContextInterface) (int64, error) {
	ts, err := ctx.GetStub().GetTxTimestamp()
	if err != nil {
		return 0, fmt.Errorf("gagal membaca timestamp transaksi: %w", err)
	}
	return ts.GetSeconds(), nil
}

func clientID(ctx contractapi.TransactionContextInterface) (string, error) {
	// Pakai CommonName sertifikat X.509 sebagai identitas (stabil & terbaca),
	// bukan GetID() base64. Backend menyimpan FabricClientId = CN ini.
	cert, err := ctx.GetClientIdentity().GetX509Certificate()
	if err != nil {
		return "", fmt.Errorf("gagal membaca sertifikat client: %w", err)
	}
	return cert.Subject.CommonName, nil
}

func mspID(ctx contractapi.TransactionContextInterface) (string, error) {
	id, err := ctx.GetClientIdentity().GetMSPID()
	if err != nil {
		return "", fmt.Errorf("gagal membaca MSP ID: %w", err)
	}
	return id, nil
}

// assertMSP — validasi caller berasal dari salah satu MSP yang diizinkan.
// Pesan diawali "ACCESS_DENIED:" agar API gateway memetakan ke HTTP 403.
func assertMSP(ctx contractapi.TransactionContextInterface, allowed ...string) error {
	id, err := mspID(ctx)
	if err != nil {
		return err
	}
	for _, a := range allowed {
		if id == a {
			return nil
		}
	}
	return fmt.Errorf("ACCESS_DENIED: MSP %q tidak diizinkan untuk operasi ini", id)
}

func exists(ctx contractapi.TransactionContextInterface, key string) (bool, error) {
	b, err := ctx.GetStub().GetState(key)
	if err != nil {
		return false, fmt.Errorf("gagal membaca state %s: %w", key, err)
	}
	return b != nil, nil
}

func putState(ctx contractapi.TransactionContextInterface, key string, v interface{}) error {
	b, err := json.Marshal(v)
	if err != nil {
		return fmt.Errorf("gagal serialisasi %s: %w", key, err)
	}
	return ctx.GetStub().PutState(key, b)
}

func getState(ctx contractapi.TransactionContextInterface, key string, out interface{}) (bool, error) {
	b, err := ctx.GetStub().GetState(key)
	if err != nil {
		return false, fmt.Errorf("gagal membaca state %s: %w", key, err)
	}
	if b == nil {
		return false, nil
	}
	if err := json.Unmarshal(b, out); err != nil {
		return false, fmt.Errorf("gagal deserialisasi %s: %w", key, err)
	}
	return true, nil
}

func emit(ctx contractapi.TransactionContextInterface, name string, payload map[string]interface{}) error {
	b, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("gagal serialisasi event %s: %w", name, err)
	}
	return ctx.GetStub().SetEvent(name, b)
}

func readLong(ctx contractapi.TransactionContextInterface, key string) (int64, error) {
	b, err := ctx.GetStub().GetState(key)
	if err != nil {
		return 0, err
	}
	if b == nil {
		return 0, nil
	}
	var v int64
	if err := json.Unmarshal(b, &v); err != nil {
		return 0, err
	}
	return v, nil
}

// ───────────────────────── CREATE ─────────────────────────

// RegisterFarmer — daftarkan petani. NIK asli tidak pernah disimpan (hanya SHA-256).
func (c *BlockAgriContract) RegisterFarmer(ctx contractapi.TransactionContextInterface,
	farmerID, fabricClientID, nikHash string, landAreaM2 int64, regionCode string) (*FarmerRecord, error) {

	if err := assertMSP(ctx, MSPPetani, MSPKementan); err != nil {
		return nil, err
	}
	if farmerID == "" || fabricClientID == "" || nikHash == "" {
		return nil, fmt.Errorf("field wajib tidak boleh kosong")
	}
	if len(nikHash) != 64 {
		return nil, fmt.Errorf("NIK hash tidak valid: harus SHA-256 (64 karakter hex)")
	}
	if landAreaM2 <= 0 {
		return nil, fmt.Errorf("luas lahan tidak valid")
	}

	key := keyFarmer(farmerID)
	if ok, err := exists(ctx, key); err != nil {
		return nil, err
	} else if ok {
		return nil, fmt.Errorf("FarmerID sudah terdaftar: %s", farmerID)
	}

	caller, err := mspID(ctx)
	if err != nil {
		return nil, err
	}
	now, err := txTime(ctx)
	if err != nil {
		return nil, err
	}

	farmer := &FarmerRecord{
		FarmerID: farmerID, FabricClientID: fabricClientID, MSPID: caller,
		NIKHash: nikHash, LandAreaM2: landAreaM2, RegionCode: regionCode,
		IsActive: true, RegisteredAt: now, TotalHarvests: 0,
	}
	if err := putState(ctx, key, farmer); err != nil {
		return nil, err
	}
	if err := emit(ctx, "FarmerRegistered", map[string]interface{}{
		"farmerId": farmerID, "fabricClientId": fabricClientID, "regionCode": regionCode, "timestamp": now,
	}); err != nil {
		return nil, err
	}
	return farmer, nil
}

// SubmitHarvest — petani submit laporan panen. Hanya hash foto yang on-chain.
func (c *BlockAgriContract) SubmitHarvest(ctx contractapi.TransactionContextInterface,
	harvestID, farmerID, cropType string, qtyClaimedG int64, harvestDocHash string,
	gpsLat7Dec, gpsLng7Dec int64) (*HarvestRecord, error) {

	if err := assertMSP(ctx, MSPPetani); err != nil {
		return nil, err
	}

	var farmer FarmerRecord
	if ok, err := getState(ctx, keyFarmer(farmerID), &farmer); err != nil {
		return nil, err
	} else if !ok {
		return nil, fmt.Errorf("FarmerID tidak ditemukan di blockchain")
	}
	if !farmer.IsActive {
		return nil, fmt.Errorf("akun petani dinonaktifkan")
	}
	if qtyClaimedG <= 0 {
		return nil, fmt.Errorf("kuantitas panen tidak valid")
	}
	if len(harvestDocHash) != 64 {
		return nil, fmt.Errorf("hash dokumen tidak valid: harus SHA-256")
	}
	if abs(gpsLat7Dec) > 900_000_000 || abs(gpsLng7Dec) > 1_800_000_000 {
		return nil, fmt.Errorf("koordinat GPS di luar batas valid")
	}

	key := keyHarvest(harvestID)
	if ok, err := exists(ctx, key); err != nil {
		return nil, err
	} else if ok {
		return nil, fmt.Errorf("HarvestID sudah ada: %s", harvestID)
	}

	caller, err := clientID(ctx)
	if err != nil {
		return nil, err
	}
	now, err := txTime(ctx)
	if err != nil {
		return nil, err
	}

	harvest := &HarvestRecord{
		HarvestID: harvestID, FarmerID: farmerID, CropType: cropType,
		QtyClaimedG: qtyClaimedG, HarvestDocHash: harvestDocHash,
		Status: "PENDING", SubmittedBy: caller, SubmittedAt: now,
	}
	if err := putState(ctx, key, harvest); err != nil {
		return nil, err
	}

	farmer.TotalHarvests++
	if err := putState(ctx, keyFarmer(farmerID), &farmer); err != nil {
		return nil, err
	}

	if err := emit(ctx, "HarvestSubmitted", map[string]interface{}{
		"harvestId": harvestID, "farmerId": farmerID, "cropType": cropType,
		"qtyClaimedG": qtyClaimedG, "docHash": harvestDocHash, "timestamp": now,
	}); err != nil {
		return nil, err
	}
	return harvest, nil
}

// SubmitVerification — Bulog submit hasil verifikasi fisik.
// Jika APPROVED, otomatis hitung alokasi (transaksi sama).
func (c *BlockAgriContract) SubmitVerification(ctx contractapi.TransactionContextInterface,
	harvestID string, measuredWeightG int64, ocrDataHash string, deltaPercent2dp int64,
	decision, hsmSignature string) (*VerificationRecord, error) {

	if err := assertMSP(ctx, MSPBulog); err != nil {
		return nil, err
	}
	officer, err := clientID(ctx)
	if err != nil {
		return nil, err
	}
	caller, err := mspID(ctx)
	if err != nil {
		return nil, err
	}

	var harvest HarvestRecord
	if ok, err := getState(ctx, keyHarvest(harvestID), &harvest); err != nil {
		return nil, err
	} else if !ok {
		return nil, fmt.Errorf("HarvestID tidak ditemukan")
	}
	if harvest.Status != "PENDING" {
		return nil, fmt.Errorf("laporan sudah diproses: status = %s", harvest.Status)
	}
	if ok, err := exists(ctx, keyVerification(harvestID)); err != nil {
		return nil, err
	} else if ok {
		return nil, fmt.Errorf("verifikasi untuk HarvestID ini sudah ada")
	}
	if measuredWeightG <= 0 {
		return nil, fmt.Errorf("berat terukur tidak valid")
	}
	if hsmSignature == "" {
		return nil, fmt.Errorf("HSM signature wajib disertakan")
	}
	if decision != "APPROVED" && decision != "REJECTED" {
		return nil, fmt.Errorf("decision harus APPROVED atau REJECTED")
	}

	// Delta = ((measured - claimed) / claimed) * 10000  (x100 = 2 desimal)
	calculatedDelta := int64(math.Round(
		float64(measuredWeightG-harvest.QtyClaimedG) / float64(harvest.QtyClaimedG) * 10000))
	if abs(calculatedDelta-deltaPercent2dp) > DeltaToleranceBP {
		return nil, fmt.Errorf("delta tidak konsisten dengan data timbangan")
	}

	now, err := txTime(ctx)
	if err != nil {
		return nil, err
	}
	verif := &VerificationRecord{
		HarvestID: harvestID, BulogOfficerID: officer, BulogMSPID: caller,
		MeasuredWeightG: measuredWeightG, OCRDataHash: ocrDataHash,
		DeltaPercent2dp: deltaPercent2dp, Status: decision,
		HSMSignature: hsmSignature, VerifiedAt: now,
	}

	if decision == "APPROVED" {
		harvest.Status = "VERIFIED"
	} else {
		harvest.Status = "REJECTED"
	}
	if err := putState(ctx, keyHarvest(harvestID), &harvest); err != nil {
		return nil, err
	}
	if err := putState(ctx, keyVerification(harvestID), verif); err != nil {
		return nil, err
	}
	if err := emit(ctx, "VerificationCompleted", map[string]interface{}{
		"harvestId": harvestID, "farmerId": harvest.FarmerID, "decision": decision,
		"delta": deltaPercent2dp, "officerId": officer, "timestamp": now,
	}); err != nil {
		return nil, err
	}

	// Otomatis kalkulasi alokasi bila APPROVED — tidak bisa dimanipulasi manual.
	if decision == "APPROVED" {
		if _, err := calculateAllocation(ctx, harvestID, now); err != nil {
			return nil, err
		}
	}
	return verif, nil
}

// calculateAllocation — internal, dipanggil otomatis setelah verifikasi APPROVED.
func calculateAllocation(ctx contractapi.TransactionContextInterface, harvestID string, now int64) (*AllocationRecord, error) {
	var harvest HarvestRecord
	if ok, err := getState(ctx, keyHarvest(harvestID), &harvest); err != nil {
		return nil, err
	} else if !ok {
		return nil, fmt.Errorf("HarvestID tidak ditemukan saat kalkulasi")
	}

	var activePolicyID string
	if ok, err := getState(ctx, keyActivePolicyID, &activePolicyID); err != nil {
		return nil, err
	} else if !ok || activePolicyID == "" {
		return nil, fmt.Errorf("tidak ada kebijakan aktif di blockchain")
	}
	var policy PolicyRecord
	if ok, err := getState(ctx, keyPolicy(activePolicyID), &policy); err != nil {
		return nil, err
	} else if !ok {
		return nil, fmt.Errorf("kebijakan aktif tidak ditemukan")
	}
	if policy.Status != "ACTIVE" {
		return nil, fmt.Errorf("kebijakan tidak aktif: %s", policy.Status)
	}

	// Formula: pupuk_g = QtyClaimedG * Coeff4dp / 10000
	ureaG := harvest.QtyClaimedG * policy.UreaCoeff4dp / 10000
	npkG := harvest.QtyClaimedG * policy.NPKCoeff4dp / 10000
	organicG := harvest.QtyClaimedG * policy.OrganicCoeff4dp / 10000

	estimatedCostCents := ureaG/1000*UreaPricePerKgCents + npkG/1000*NPKPricePerKgCents

	budgetUsed, err := readLong(ctx, keyBudgetUsedCents)
	if err != nil {
		return nil, err
	}
	if budgetUsed+estimatedCostCents > policy.BudgetCapIDRCents {
		_ = emit(ctx, "BudgetWarning", map[string]interface{}{
			"harvestId": harvestID, "deficit": estimatedCostCents, "timestamp": now,
		})
	}

	alloc := &AllocationRecord{
		HarvestID: harvestID, FarmerID: harvest.FarmerID,
		UreaG: ureaG, NPKG: npkG, OrganicG: organicG,
		FormulaVersion: policy.PolicyID, PolicyID: activePolicyID, CalculatedAt: now,
	}
	if err := putState(ctx, keyAllocation(harvestID), alloc); err != nil {
		return nil, err
	}
	if err := putState(ctx, keyBudgetUsedCents, budgetUsed+estimatedCostCents); err != nil {
		return nil, err
	}
	if err := emit(ctx, "AllocationCalculated", map[string]interface{}{
		"harvestId": harvestID, "farmerId": harvest.FarmerID,
		"ureaG": ureaG, "npkG": npkG, "organicG": organicG,
		"policyId": activePolicyID, "timestamp": now,
	}); err != nil {
		return nil, err
	}
	return alloc, nil
}

// ───────────────────────── POLICY ─────────────────────────

// ProposePolicy — Kementan usulkan kebijakan subsidi baru (PENDING_APPROVAL).
func (c *BlockAgriContract) ProposePolicy(ctx contractapi.TransactionContextInterface,
	policyID, policyName, contentHash string, ureaCoeff4dp, npkCoeff4dp, organicCoeff4dp,
	budgetCapIdrCents, effectiveDate int64) (*PolicyRecord, error) {

	if err := assertMSP(ctx, MSPKementan); err != nil {
		return nil, err
	}
	if ureaCoeff4dp <= 0 || npkCoeff4dp <= 0 {
		return nil, fmt.Errorf("koefisien subsidi harus positif")
	}
	if budgetCapIdrCents <= 0 {
		return nil, fmt.Errorf("budget cap harus positif")
	}
	if ok, err := exists(ctx, keyPolicy(policyID)); err != nil {
		return nil, err
	} else if ok {
		return nil, fmt.Errorf("PolicyID sudah ada")
	}

	proposer, err := clientID(ctx)
	if err != nil {
		return nil, err
	}
	now, err := txTime(ctx)
	if err != nil {
		return nil, err
	}

	policy := &PolicyRecord{
		PolicyID: policyID, PolicyName: policyName, PolicyContentHash: contentHash,
		ProposedByID: proposer, ProposedByMSPID: MSPKementan, ApprovedByID: "",
		Status:       "PENDING_APPROVAL",
		UreaCoeff4dp: ureaCoeff4dp, NPKCoeff4dp: npkCoeff4dp, OrganicCoeff4dp: organicCoeff4dp,
		BudgetCapIDRCents: budgetCapIdrCents, EffectiveDate: effectiveDate, SupersededBy: "",
	}
	if err := putState(ctx, keyPolicy(policyID), policy); err != nil {
		return nil, err
	}
	if err := emit(ctx, "PolicyProposed", map[string]interface{}{
		"policyId": policyID, "proposedBy": proposer, "timestamp": now,
	}); err != nil {
		return nil, err
	}
	return policy, nil
}

// ApprovePolicy — Kemenkeu setujui & aktifkan kebijakan. Policy lama → SUPERSEDED.
func (c *BlockAgriContract) ApprovePolicy(ctx contractapi.TransactionContextInterface,
	policyID string) (*PolicyRecord, error) {

	if err := assertMSP(ctx, MSPKemenkeu); err != nil {
		return nil, err
	}
	var policy PolicyRecord
	if ok, err := getState(ctx, keyPolicy(policyID), &policy); err != nil {
		return nil, err
	} else if !ok {
		return nil, fmt.Errorf("PolicyID tidak ditemukan")
	}
	if policy.Status != "PENDING_APPROVAL" {
		return nil, fmt.Errorf("policy tidak dalam status PENDING_APPROVAL")
	}

	var oldID string
	if _, err := getState(ctx, keyActivePolicyID, &oldID); err != nil {
		return nil, err
	}
	if oldID != "" {
		var old PolicyRecord
		if ok, err := getState(ctx, keyPolicy(oldID), &old); err != nil {
			return nil, err
		} else if ok {
			old.Status = "SUPERSEDED"
			old.SupersededBy = policyID
			if err := putState(ctx, keyPolicy(oldID), &old); err != nil {
				return nil, err
			}
		}
	}

	approver, err := clientID(ctx)
	if err != nil {
		return nil, err
	}
	now, err := txTime(ctx)
	if err != nil {
		return nil, err
	}

	policy.Status = "ACTIVE"
	policy.ApprovedByID = approver
	policy.ApprovedByMSPID = MSPKemenkeu
	if err := putState(ctx, keyPolicy(policyID), &policy); err != nil {
		return nil, err
	}
	if err := putState(ctx, keyActivePolicyID, policyID); err != nil {
		return nil, err
	}
	if err := emit(ctx, "PolicyActivated", map[string]interface{}{
		"policyId": policyID, "approvedBy": approver, "timestamp": now,
	}); err != nil {
		return nil, err
	}
	return &policy, nil
}

// ───────────────────────── DISTRIBUSI ─────────────────────────

// CreateDistribution — PIHC buat order distribusi berdasarkan AllocationID.
func (c *BlockAgriContract) CreateDistribution(ctx contractapi.TransactionContextInterface,
	distributionID, allocationID, farmerID string) (*DistributionRecord, error) {

	if err := assertMSP(ctx, MSPPihc); err != nil {
		return nil, err
	}
	if ok, err := exists(ctx, keyAllocation(allocationID)); err != nil {
		return nil, err
	} else if !ok {
		return nil, fmt.Errorf("AllocationID tidak ditemukan")
	}
	if ok, err := exists(ctx, keyDistByAlloc(allocationID)); err != nil {
		return nil, err
	} else if ok {
		return nil, fmt.Errorf("distribusi untuk alokasi ini sudah dibuat")
	}

	agent, err := clientID(ctx)
	if err != nil {
		return nil, err
	}
	now, err := txTime(ctx)
	if err != nil {
		return nil, err
	}

	dist := &DistributionRecord{
		DistributionID: distributionID, AllocationID: allocationID,
		PIHCAgentID: agent, PIHCAgentMSPID: MSPPihc, FarmerID: farmerID,
		Status: "CREATED", DeliveryProofHash: "",
	}
	if err := putState(ctx, keyDistribution(distributionID), dist); err != nil {
		return nil, err
	}
	if err := putState(ctx, keyDistByAlloc(allocationID), distributionID); err != nil {
		return nil, err
	}
	if err := emit(ctx, "DistributionCreated", map[string]interface{}{
		"distributionId": distributionID, "allocationId": allocationID, "farmerId": farmerID, "timestamp": now,
	}); err != nil {
		return nil, err
	}
	return dist, nil
}

// UpdateDistributionStatus — transisi CREATED→SHIPPED→DELIVERED→CONFIRMED dgn kontrol MSP.
func (c *BlockAgriContract) UpdateDistributionStatus(ctx contractapi.TransactionContextInterface,
	distributionID, newStatus, deliveryProofHash string) (*DistributionRecord, error) {

	caller, err := mspID(ctx)
	if err != nil {
		return nil, err
	}
	cid, err := clientID(ctx)
	if err != nil {
		return nil, err
	}

	var dist DistributionRecord
	if ok, err := getState(ctx, keyDistribution(distributionID), &dist); err != nil {
		return nil, err
	} else if !ok {
		return nil, fmt.Errorf("DistributionID tidak ditemukan")
	}

	now, err := txTime(ctx)
	if err != nil {
		return nil, err
	}

	switch dist.Status {
	case "CREATED":
		if newStatus != "SHIPPED" {
			return nil, fmt.Errorf("dari CREATED hanya bisa ke SHIPPED")
		}
		if caller != MSPPihc {
			return nil, fmt.Errorf("ACCESS_DENIED: SHIPPED hanya bisa dilakukan PIHCMSP")
		}
		dist.ShippedAt = now
	case "SHIPPED":
		if newStatus != "DELIVERED" {
			return nil, fmt.Errorf("dari SHIPPED hanya bisa ke DELIVERED")
		}
		if caller != MSPPihc {
			return nil, fmt.Errorf("ACCESS_DENIED: DELIVERED hanya bisa dilakukan PIHCMSP")
		}
		if deliveryProofHash == "" {
			return nil, fmt.Errorf("foto bukti serah terima wajib disertakan")
		}
		dist.DeliveryProofHash = deliveryProofHash
		dist.DeliveredAt = now
	case "DELIVERED":
		if newStatus != "CONFIRMED" {
			return nil, fmt.Errorf("dari DELIVERED hanya bisa ke CONFIRMED")
		}
		if caller != MSPPetani {
			return nil, fmt.Errorf("ACCESS_DENIED: CONFIRMED hanya bisa dilakukan petani penerima")
		}
		if cid != dist.FarmerID {
			return nil, fmt.Errorf("ACCESS_DENIED: hanya petani penerima yang dapat konfirmasi")
		}
		dist.ConfirmedAt = now
	default:
		return nil, fmt.Errorf("transisi status tidak valid")
	}

	dist.Status = newStatus
	if err := putState(ctx, keyDistribution(distributionID), &dist); err != nil {
		return nil, err
	}
	if err := emit(ctx, "DistributionStatusUpdated", map[string]interface{}{
		"distributionId": distributionID, "newStatus": newStatus, "clientId": cid, "timestamp": now,
	}); err != nil {
		return nil, err
	}
	return &dist, nil
}

// ───────────────────────── PEMBAYARAN ─────────────────────────

// RequestPayment — PIHC ajukan klaim pencairan subsidi (distribusi harus CONFIRMED).
func (c *BlockAgriContract) RequestPayment(ctx contractapi.TransactionContextInterface,
	distributionID string, amountIdrCents int64) (*PaymentRecord, error) {

	if err := assertMSP(ctx, MSPPihc); err != nil {
		return nil, err
	}
	var dist DistributionRecord
	if ok, err := getState(ctx, keyDistribution(distributionID), &dist); err != nil {
		return nil, err
	} else if !ok {
		return nil, fmt.Errorf("DistributionID tidak ditemukan")
	}
	if dist.Status != "CONFIRMED" {
		return nil, fmt.Errorf("distribusi belum CONFIRMED oleh petani")
	}
	if ok, err := exists(ctx, keyPaymentByDist(distributionID)); err != nil {
		return nil, err
	} else if ok {
		return nil, fmt.Errorf("klaim untuk distribusi ini sudah diajukan")
	}
	if amountIdrCents <= 0 {
		return nil, fmt.Errorf("nominal subsidi tidak valid")
	}

	requester, err := clientID(ctx)
	if err != nil {
		return nil, err
	}
	now, err := txTime(ctx)
	if err != nil {
		return nil, err
	}

	payment := &PaymentRecord{
		DistributionID: distributionID, AmountIDRCents: amountIdrCents, Status: "REQUESTED",
	}
	if err := putState(ctx, keyPaymentByDist(distributionID), payment); err != nil {
		return nil, err
	}
	if err := emit(ctx, "PaymentRequested", map[string]interface{}{
		"distributionId": distributionID, "amountIdrCents": amountIdrCents, "requestedBy": requester, "timestamp": now,
	}); err != nil {
		return nil, err
	}
	return payment, nil
}

// ApprovePayment — Kemenkeu setujui & catat pencairan subsidi on-chain.
func (c *BlockAgriContract) ApprovePayment(ctx contractapi.TransactionContextInterface,
	distributionID, kemenkeuRefHash string) (*PaymentRecord, error) {

	if err := assertMSP(ctx, MSPKemenkeu); err != nil {
		return nil, err
	}
	var payment PaymentRecord
	if ok, err := getState(ctx, keyPaymentByDist(distributionID), &payment); err != nil {
		return nil, err
	} else if !ok {
		return nil, fmt.Errorf("payment request tidak ditemukan")
	}
	if payment.Status != "REQUESTED" {
		return nil, fmt.Errorf("payment tidak dalam status REQUESTED")
	}
	if kemenkeuRefHash == "" {
		return nil, fmt.Errorf("nomor referensi Kemenkeu wajib")
	}

	approver, err := clientID(ctx)
	if err != nil {
		return nil, err
	}
	now, err := txTime(ctx)
	if err != nil {
		return nil, err
	}

	payment.Status = "DISBURSED"
	payment.KemenkeuRefHash = kemenkeuRefHash
	payment.ApprovedByID = approver
	payment.ApprovedByMSPID = MSPKemenkeu
	payment.ProcessedAt = now
	if err := putState(ctx, keyPaymentByDist(distributionID), &payment); err != nil {
		return nil, err
	}
	if err := emit(ctx, "PaymentDisbursed", map[string]interface{}{
		"distributionId": distributionID, "amountIdrCents": payment.AmountIDRCents,
		"approvedBy": approver, "kemenkeuRefHash": kemenkeuRefHash, "timestamp": now,
	}); err != nil {
		return nil, err
	}
	return &payment, nil
}

// RejectPayment — Kemenkeu tolak klaim dengan alasan tercatat.
func (c *BlockAgriContract) RejectPayment(ctx contractapi.TransactionContextInterface,
	distributionID, reason string) (*PaymentRecord, error) {

	if err := assertMSP(ctx, MSPKemenkeu); err != nil {
		return nil, err
	}
	var payment PaymentRecord
	if ok, err := getState(ctx, keyPaymentByDist(distributionID), &payment); err != nil {
		return nil, err
	} else if !ok {
		return nil, fmt.Errorf("payment request tidak ditemukan")
	}
	if payment.Status != "REQUESTED" {
		return nil, fmt.Errorf("payment tidak dalam status REQUESTED")
	}

	rejecter, err := clientID(ctx)
	if err != nil {
		return nil, err
	}
	now, err := txTime(ctx)
	if err != nil {
		return nil, err
	}

	payment.Status = "REJECTED"
	payment.RejectReason = reason
	payment.ApprovedByID = rejecter
	payment.ApprovedByMSPID = MSPKemenkeu
	payment.ProcessedAt = now
	if err := putState(ctx, keyPaymentByDist(distributionID), &payment); err != nil {
		return nil, err
	}
	if err := emit(ctx, "PaymentRejected", map[string]interface{}{
		"distributionId": distributionID, "reason": reason, "rejectedBy": rejecter, "timestamp": now,
	}); err != nil {
		return nil, err
	}
	return &payment, nil
}

// DisableFarmer — Kementan nonaktifkan akun petani (soft delete).
func (c *BlockAgriContract) DisableFarmer(ctx contractapi.TransactionContextInterface,
	farmerID string) (*FarmerRecord, error) {

	if err := assertMSP(ctx, MSPKementan); err != nil {
		return nil, err
	}
	var farmer FarmerRecord
	if ok, err := getState(ctx, keyFarmer(farmerID), &farmer); err != nil {
		return nil, err
	} else if !ok {
		return nil, fmt.Errorf("FarmerID tidak ditemukan")
	}

	disabler, err := clientID(ctx)
	if err != nil {
		return nil, err
	}
	now, err := txTime(ctx)
	if err != nil {
		return nil, err
	}

	farmer.IsActive = false
	if err := putState(ctx, keyFarmer(farmerID), &farmer); err != nil {
		return nil, err
	}
	if err := emit(ctx, "FarmerDisabled", map[string]interface{}{
		"farmerId": farmerID, "disabledBy": disabler, "timestamp": now,
	}); err != nil {
		return nil, err
	}
	return &farmer, nil
}

// ───────────────────────── READ (query World State) ─────────────────────────

func (c *BlockAgriContract) GetFarmer(ctx contractapi.TransactionContextInterface, farmerID string) (*FarmerRecord, error) {
	var r FarmerRecord
	ok, err := getState(ctx, keyFarmer(farmerID), &r)
	if err != nil || !ok {
		return nil, err
	}
	return &r, nil
}

func (c *BlockAgriContract) GetHarvestById(ctx contractapi.TransactionContextInterface, harvestID string) (*HarvestRecord, error) {
	var r HarvestRecord
	ok, err := getState(ctx, keyHarvest(harvestID), &r)
	if err != nil || !ok {
		return nil, err
	}
	return &r, nil
}

func (c *BlockAgriContract) GetVerification(ctx contractapi.TransactionContextInterface, harvestID string) (*VerificationRecord, error) {
	var r VerificationRecord
	ok, err := getState(ctx, keyVerification(harvestID), &r)
	if err != nil || !ok {
		return nil, err
	}
	return &r, nil
}

func (c *BlockAgriContract) GetAllocation(ctx contractapi.TransactionContextInterface, harvestID string) (*AllocationRecord, error) {
	var r AllocationRecord
	ok, err := getState(ctx, keyAllocation(harvestID), &r)
	if err != nil || !ok {
		return nil, err
	}
	return &r, nil
}

func (c *BlockAgriContract) GetDistribution(ctx contractapi.TransactionContextInterface, distributionID string) (*DistributionRecord, error) {
	var r DistributionRecord
	ok, err := getState(ctx, keyDistribution(distributionID), &r)
	if err != nil || !ok {
		return nil, err
	}
	return &r, nil
}

func (c *BlockAgriContract) GetPayment(ctx contractapi.TransactionContextInterface, distributionID string) (*PaymentRecord, error) {
	var r PaymentRecord
	ok, err := getState(ctx, keyPaymentByDist(distributionID), &r)
	if err != nil || !ok {
		return nil, err
	}
	return &r, nil
}

func (c *BlockAgriContract) GetActivePolicy(ctx contractapi.TransactionContextInterface) (*PolicyRecord, error) {
	var id string
	if ok, err := getState(ctx, keyActivePolicyID, &id); err != nil || !ok || id == "" {
		return nil, err
	}
	var r PolicyRecord
	ok, err := getState(ctx, keyPolicy(id), &r)
	if err != nil || !ok {
		return nil, err
	}
	return &r, nil
}

// GetState — baca nilai mentah (JSON) sebuah key World State (untuk Explorer/verify-hash).
func (c *BlockAgriContract) GetState(ctx contractapi.TransactionContextInterface, key string) (string, error) {
	b, err := ctx.GetStub().GetState(key)
	if err != nil {
		return "", fmt.Errorf("gagal membaca state %s: %w", key, err)
	}
	return string(b), nil
}

// GetTransactionHistory — audit trail GetHistoryForKey untuk satu key World State.
func (c *BlockAgriContract) GetTransactionHistory(ctx contractapi.TransactionContextInterface, objectKey string) ([]HistoryEntry, error) {
	iter, err := ctx.GetStub().GetHistoryForKey(objectKey)
	if err != nil {
		return nil, fmt.Errorf("gagal membaca riwayat %s: %w", objectKey, err)
	}
	defer iter.Close()

	var out []HistoryEntry
	for iter.HasNext() {
		km, err := iter.Next()
		if err != nil {
			return nil, err
		}
		out = append(out, HistoryEntry{
			TxID:      km.GetTxId(),
			Timestamp: km.GetTimestamp().GetSeconds(),
			IsDelete:  km.GetIsDelete(),
			Value:     string(km.GetValue()),
		})
	}
	return out, nil
}

func abs(x int64) int64 {
	if x < 0 {
		return -x
	}
	return x
}
