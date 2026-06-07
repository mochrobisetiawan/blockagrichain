package chain

// Struct hasil decode dari chaincode (json tag = sama dgn chaincode/records.go).
// Dipakai untuk meng-unmarshal hasil Evaluate/Submit dari Fabric.

type FarmerRecord struct {
	FarmerID       string `json:"farmerId"`
	FabricClientID string `json:"fabricClientId"`
	MSPID          string `json:"mspId"`
	NIKHash        string `json:"nikHash"`
	LandAreaM2     int64  `json:"landAreaM2"`
	RegionCode     string `json:"regionCode"`
	IsActive       bool   `json:"isActive"`
	RegisteredAt   int64  `json:"registeredAt"`
	TotalHarvests  int64  `json:"totalHarvests"`
}

type HarvestRecord struct {
	HarvestID      string `json:"harvestId"`
	FarmerID       string `json:"farmerId"`
	CropType       string `json:"cropType"`
	QtyClaimedG    int64  `json:"qtyClaimedG"`
	HarvestDocHash string `json:"harvestDocHash"`
	Status         string `json:"status"`
	SubmittedBy    string `json:"submittedBy"`
	SubmittedAt    int64  `json:"submittedAt"`
}

type VerificationRecord struct {
	HarvestID       string `json:"harvestId"`
	BulogOfficerID  string `json:"bulogOfficerId"`
	BulogMSPID      string `json:"bulogMspId"`
	MeasuredWeightG int64  `json:"measuredWeightG"`
	OCRDataHash     string `json:"ocrDataHash"`
	DeltaPercent2dp int64  `json:"deltaPercent2dp"`
	Status          string `json:"status"`
	HSMSignature    string `json:"hsmSignature"`
	VerifiedAt      int64  `json:"verifiedAt"`
}

type AllocationRecord struct {
	HarvestID      string `json:"harvestId"`
	FarmerID       string `json:"farmerId"`
	UreaG          int64  `json:"ureaG"`
	NPKG           int64  `json:"npkG"`
	OrganicG       int64  `json:"organicG"`
	FormulaVersion string `json:"formulaVersion"`
	PolicyID       string `json:"policyId"`
	CalculatedAt   int64  `json:"calculatedAt"`
}

type DistributionRecord struct {
	DistributionID    string `json:"distributionId"`
	AllocationID      string `json:"allocationId"`
	PIHCAgentID       string `json:"pihcAgentId"`
	PIHCAgentMSPID    string `json:"pihcAgentMspId"`
	FarmerID          string `json:"farmerId"`
	Status            string `json:"status"`
	DeliveryProofHash string `json:"deliveryProofHash"`
	ShippedAt         int64  `json:"shippedAt"`
	DeliveredAt       int64  `json:"deliveredAt"`
	ConfirmedAt       int64  `json:"confirmedAt"`
}

type PaymentRecord struct {
	DistributionID  string `json:"distributionId"`
	AmountIDRCents  int64  `json:"amountIdrCents"`
	Status          string `json:"status"`
	KemenkeuRefHash string `json:"kemenkeuRefHash"`
	ApprovedByID    string `json:"approvedById"`
	ApprovedByMSPID string `json:"approvedByMspId"`
	RejectReason    string `json:"rejectReason"`
	ProcessedAt     int64  `json:"processedAt"`
}

type PolicyRecord struct {
	PolicyID          string `json:"policyId"`
	PolicyName        string `json:"policyName"`
	PolicyContentHash string `json:"policyContentHash"`
	ProposedByID      string `json:"proposedById"`
	ProposedByMSPID   string `json:"proposedByMspId"`
	ApprovedByID      string `json:"approvedById"`
	ApprovedByMSPID   string `json:"approvedByMspId"`
	Status            string `json:"status"`
	UreaCoeff4dp      int64  `json:"ureaCoeff4dp"`
	NPKCoeff4dp       int64  `json:"npkCoeff4dp"`
	OrganicCoeff4dp   int64  `json:"organicCoeff4dp"`
	BudgetCapIDRCents int64  `json:"budgetCapIdrCents"`
	EffectiveDate     int64  `json:"effectiveDate"`
	SupersededBy      string `json:"supersededBy"`
}

// HistoryEntry — hasil GetTransactionHistory chaincode.
type HistoryEntry struct {
	TxID      string `json:"txId"`
	Timestamp int64  `json:"timestamp"`
	IsDelete  bool   `json:"isDelete"`
	Value     string `json:"value"`
}
