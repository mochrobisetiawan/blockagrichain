package main

// ============================================================================
//  STATE DATA SMART CONTRACT (ON-CHAIN) — DPPL bab III.2
//  Hanya menyimpan data yang perlu immutable. Tidak ada PII.
//  Satuan integer (gram, cents x100, koefisien x10000) untuk menghindari float.
//  Port 1:1 dari ChainRecords.cs (implementasi C# tervalidasi).
// ============================================================================

// FarmerRecord — identitas petani on-chain, tanpa PII (NIK hanya hash).
type FarmerRecord struct {
	FarmerID       string `json:"farmerId"`       // Composite: "FARMER" + FabricClientID
	FabricClientID string `json:"fabricClientId"` // X.509 CN dari MSP
	MSPID          string `json:"mspId"`          // "PetaniMSP"
	NIKHash        string `json:"nikHash"`        // SHA-256(NIK) — bukan NIK asli
	LandAreaM2     int64  `json:"landAreaM2"`
	RegionCode     string `json:"regionCode"`
	IsActive       bool   `json:"isActive"`
	RegisteredAt   int64  `json:"registeredAt"` // Unix timestamp (audit)
	TotalHarvests  int64  `json:"totalHarvests"`
}

// HarvestRecord — laporan panen on-chain (hash dokumen + ID petani + timestamp).
type HarvestRecord struct {
	HarvestID      string `json:"harvestId"`
	FarmerID       string `json:"farmerId"`
	CropType       string `json:"cropType"`
	QtyClaimedG    int64  `json:"qtyClaimedG"`    // Gram — hindari float
	HarvestDocHash string `json:"harvestDocHash"` // SHA-256 foto/dokumen panen
	Status         string `json:"status"`         // PENDING / VERIFIED / REJECTED
	SubmittedBy    string `json:"submittedBy"`    // FabricClientID petani
	SubmittedAt    int64  `json:"submittedAt"`
}

// VerificationRecord — keputusan verifikasi Bulog, immutable setelah commit.
type VerificationRecord struct {
	HarvestID       string `json:"harvestId"`
	BulogOfficerID  string `json:"bulogOfficerId"` // FabricClientID petugas Bulog
	BulogMSPID      string `json:"bulogMspId"`     // harus "BulogMSP"
	MeasuredWeightG int64  `json:"measuredWeightG"`
	OCRDataHash     string `json:"ocrDataHash"`
	DeltaPercent2dp int64  `json:"deltaPercent2dp"` // Selisih x100 (mis: -83 = -0.83%)
	Status          string `json:"status"`          // APPROVED / REJECTED
	HSMSignature    string `json:"hsmSignature"`    // Tanda tangan digital HSM
	VerifiedAt      int64  `json:"verifiedAt"`
}

// AllocationRecord — kuota subsidi dihitung OTOMATIS oleh chaincode setelah VERIFIED.
type AllocationRecord struct {
	HarvestID      string `json:"harvestId"`
	FarmerID       string `json:"farmerId"`
	UreaG          int64  `json:"ureaG"`    // Kuota Urea — gram
	NPKG           int64  `json:"npkG"`     // Kuota NPK — gram
	OrganicG       int64  `json:"organicG"` // Kuota Organik — gram
	FormulaVersion string `json:"formulaVersion"`
	PolicyID       string `json:"policyId"`
	CalculatedAt   int64  `json:"calculatedAt"`
}

// DistributionRecord — order distribusi pupuk PIHC.
type DistributionRecord struct {
	DistributionID    string `json:"distributionId"`
	AllocationID      string `json:"allocationId"`
	PIHCAgentID       string `json:"pihcAgentId"`    // FabricClientID agen PIHC
	PIHCAgentMSPID    string `json:"pihcAgentMspId"` // harus "PIHCMSP"
	FarmerID          string `json:"farmerId"`
	Status            string `json:"status"`            // CREATED/SHIPPED/DELIVERED/CONFIRMED
	DeliveryProofHash string `json:"deliveryProofHash"` // SHA-256 foto serah terima
	ShippedAt         int64  `json:"shippedAt"`
	DeliveredAt       int64  `json:"deliveredAt"`
	ConfirmedAt       int64  `json:"confirmedAt"`
}

// PaymentRecord — pencairan subsidi Kemenkeu.
type PaymentRecord struct {
	DistributionID  string `json:"distributionId"`
	AmountIDRCents  int64  `json:"amountIdrCents"` // Rupiah x100 — hindari float
	Status          string `json:"status"`         // REQUESTED/DISBURSED/REJECTED
	KemenkeuRefHash string `json:"kemenkeuRefHash"`
	ApprovedByID    string `json:"approvedById"`
	ApprovedByMSPID string `json:"approvedByMspId"` // harus "KemenkeuMSP"
	RejectReason    string `json:"rejectReason"`
	ProcessedAt     int64  `json:"processedAt"`
}

// PolicyRecord — kebijakan subsidi: ProposePolicy (Kementan) → ApprovePolicy (Kemenkeu).
type PolicyRecord struct {
	PolicyID          string `json:"policyId"`
	PolicyName        string `json:"policyName"`
	PolicyContentHash string `json:"policyContentHash"`
	ProposedByID      string `json:"proposedById"`
	ProposedByMSPID   string `json:"proposedByMspId"`
	ApprovedByID      string `json:"approvedById"`
	ApprovedByMSPID   string `json:"approvedByMspId"`
	Status            string `json:"status"`        // DRAFT/PENDING_APPROVAL/ACTIVE/SUPERSEDED
	UreaCoeff4dp      int64  `json:"ureaCoeff4dp"`  // koefisien x10000
	NPKCoeff4dp       int64  `json:"npkCoeff4dp"`
	OrganicCoeff4dp   int64  `json:"organicCoeff4dp"`
	BudgetCapIDRCents int64  `json:"budgetCapIdrCents"`
	EffectiveDate     int64  `json:"effectiveDate"`
	SupersededBy      string `json:"supersededBy"`
}

// HistoryEntry — satu titik riwayat GetHistoryForKey (audit trail).
type HistoryEntry struct {
	TxID      string `json:"txId"`
	Timestamp int64  `json:"timestamp"`
	IsDelete  bool   `json:"isDelete"`
	Value     string `json:"value"` // JSON state pada titik waktu itu
}

// ──────────────── Pola key World State (DPPL bab V.3) ────────────────

func keyFarmer(id string) string        { return "FARMER_" + id }
func keyHarvest(id string) string       { return "HARVEST_" + id }
func keyVerification(id string) string  { return "VERIF_" + id }
func keyAllocation(id string) string    { return "ALLOC_" + id }
func keyDistribution(id string) string  { return "DIST_" + id }
func keyDistByAlloc(allocID string) string { return "DIST_ALLOC_" + allocID }
func keyPaymentByDist(distID string) string { return "PAY_DIST_" + distID }
func keyPolicy(id string) string        { return "POLICY_" + id }

const (
	keyActivePolicyID  = "ACTIVE_POLICY_ID"
	keyBudgetUsedCents = "BUDGET_USED_CENTS"
)

// ──────────────── Konstanta MSP (1:1 dengan peran) ────────────────

const (
	MSPPetani   = "PetaniMSP"
	MSPBulog    = "BulogMSP"
	MSPKementan = "KementanMSP"
	MSPKemenkeu = "KemenkeuMSP"
	MSPPihc     = "PIHCMSP"
)

// Harga acuan pupuk subsidi (Rupiah x100 "cents" per kg) & toleransi delta.
const (
	UreaPricePerKgCents = 225_000 // Rp 2.250/kg
	NPKPricePerKgCents  = 230_000 // Rp 2.300/kg
	DeltaToleranceBP    = 10      // toleransi delta ±10 basis point
)
