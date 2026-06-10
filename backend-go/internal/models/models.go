package models

import "time"

// Entitas off-chain (Postgres) — sepadan ERD DPPL bab III.1 & Entities.cs.
// blockchain_tx_id pada tiap tabel = pointer audit ke ledger Fabric.

// ── Enum sebagai string konstanta (cocok dgn nilai on-chain) ──
const (
	RoleFarmer   = "FARMER"
	RoleBulog    = "BULOG"
	RoleKementan = "KEMENTAN"
	RoleKemenkeu = "KEMENKEU"
	RolePihc     = "PIHC"

	HarvestPending  = "PENDING"
	HarvestVerified = "VERIFIED"
	HarvestRejected = "REJECTED"

	DistCreated   = "CREATED"
	DistShipped   = "SHIPPED"
	DistDelivered = "DELIVERED"
	DistConfirmed = "CONFIRMED"

	PayRequested = "REQUESTED"
	PayDisbursed = "DISBURSED"
	PayRejected  = "REJECTED"

	PolicyDraft      = "DRAFT"
	PolicyPending    = "PENDING_APPROVAL"
	PolicyActive     = "ACTIVE"
	PolicySuperseded = "SUPERSEDED"
)

// MSPForRole — pemetaan 1:1 role → organisasi MSP.
func MSPForRole(role string) string {
	switch role {
	case RoleFarmer:
		return "PetaniMSP"
	case RoleBulog:
		return "BulogMSP"
	case RoleKementan:
		return "KementanMSP"
	case RoleKemenkeu:
		return "KemenkeuMSP"
	case RolePihc:
		return "PIHCMSP"
	}
	return ""
}

type User struct {
	ID             int64  `gorm:"primaryKey;column:id" json:"id"`
	Username       string `gorm:"column:username;uniqueIndex;size:100" json:"username"`
	Email          string `gorm:"column:email;size:255" json:"email"`
	PasswordHash   string `gorm:"column:password_hash;size:255" json:"-"`
	Role           string `gorm:"column:role;size:20" json:"role"`
	FabricClientID string `gorm:"column:fabric_client_id;size:255" json:"fabricClientId"`
	MspID          string `gorm:"column:msp_id;size:100" json:"mspId"`
	IsActive       bool   `gorm:"column:is_active;default:true" json:"isActive"`
	CreatedAt      time.Time `gorm:"column:created_at" json:"createdAt"`
}

func (User) TableName() string { return "users" }

type Farmer struct {
	ID              int64      `gorm:"primaryKey;column:id" json:"id"`
	UserID          int64      `gorm:"column:user_id" json:"userId"`
	Nik             string     `gorm:"column:nik;size:16" json:"-"` // PII — tak pernah diekspos
	FullName        string     `gorm:"column:full_name;size:200" json:"fullName"`
	Phone           *string    `gorm:"column:phone;size:20" json:"phone,omitempty"`
	ProfilePhotoURL *string    `gorm:"column:profile_photo_url" json:"profilePhotoUrl,omitempty"`
	BirthDate       *time.Time `gorm:"column:birth_date" json:"birthDate,omitempty"`
	AddressDetail   *string    `gorm:"column:address_detail" json:"addressDetail,omitempty"`
	FarmerGroup     *string    `gorm:"column:farmer_group;size:100" json:"farmerGroup,omitempty"`
	FarmerChainID   string     `gorm:"column:farmer_chain_id;size:128" json:"farmerChainId"`

	User      *User      `gorm:"foreignKey:UserID" json:"-"`
	FarmLands []FarmLand `gorm:"foreignKey:FarmerID" json:"-"`
}

func (Farmer) TableName() string { return "farmers" }

type FarmLand struct {
	ID         int64    `gorm:"primaryKey;column:id" json:"id"`
	FarmerID   int64    `gorm:"column:farmer_id" json:"-"`
	LandAreaHa float64  `gorm:"column:land_area_ha" json:"landAreaHa"`
	Village    string   `gorm:"column:village;size:100" json:"village"`
	District   string   `gorm:"column:district;size:100" json:"district"`
	City       string   `gorm:"column:city;size:100" json:"city"`
	Province   string   `gorm:"column:province;size:100" json:"province"`
	GpsLat     *float64 `gorm:"column:gps_lat" json:"gpsLat,omitempty"`
	GpsLng     *float64 `gorm:"column:gps_lng" json:"gpsLng,omitempty"`
	GpsPolygon *string  `gorm:"column:gps_polygon" json:"gpsPolygon,omitempty"`
	IsPrimary  bool     `gorm:"column:is_primary" json:"isPrimary"`
}

func (FarmLand) TableName() string { return "farm_lands" }

type Harvest struct {
	ID              int64     `gorm:"primaryKey;column:id" json:"id"`
	FarmerID        int64     `gorm:"column:farmer_id" json:"-"`
	LandID          int64     `gorm:"column:land_id" json:"-"`
	CropType        string    `gorm:"column:crop_type;size:100" json:"cropType"`
	QtyClaimedKg    float64   `gorm:"column:qty_claimed_kg" json:"qtyClaimedKg"`
	HarvestPhotoURL *string   `gorm:"column:harvest_photo_url" json:"harvestPhotoUrl,omitempty"`
	HarvestDocHash  string    `gorm:"column:harvest_doc_hash;size:64" json:"harvestDocHash"`
	Status          string    `gorm:"column:status;size:20" json:"status"`
	HarvestChainID  string    `gorm:"column:harvest_chain_id;size:128" json:"harvestChainId"`
	BlockchainTxID  *string   `gorm:"column:blockchain_tx_id;size:128" json:"blockchainTxId,omitempty"`
	SubmittedAt     time.Time `gorm:"column:submitted_at" json:"submittedAt"`

	// Data IoT dari ESP32-CAM (Smart Scale): ID perangkat + URL gambar display + hasil OCR berat.
	IoTDeviceID *string  `gorm:"column:iot_device_id;size:64" json:"iotDeviceId,omitempty"`
	IoTImageURL *string  `gorm:"column:iot_image_url" json:"iotImageUrl,omitempty"`
	IoTWeightKg *float64 `gorm:"column:iot_weight_kg" json:"iotWeightKg,omitempty"`
	IoTOcrRaw   *string  `gorm:"column:iot_ocr_raw;size:50" json:"iotOcrRaw,omitempty"`
	// Foto bukti fisik tumpukan panen versi Bulog (dikirim bersama data IoT).
	BulogPhotoURL *string `gorm:"column:bulog_photo_url" json:"bulogPhotoUrl,omitempty"`

	Farmer       *Farmer       `gorm:"foreignKey:FarmerID" json:"-"`
	Land         *FarmLand     `gorm:"foreignKey:LandID" json:"-"`
	Verification *Verification `gorm:"foreignKey:HarvestRecordID" json:"-"`
	Allocation   *Allocation   `gorm:"foreignKey:HarvestRecordID" json:"-"`
}

func (Harvest) TableName() string { return "harvest" }

type Verification struct {
	ID               int64     `gorm:"primaryKey;column:id" json:"id"`
	HarvestRecordID  int64     `gorm:"column:harvest_record_id" json:"-"`
	BulogOfficerID   int64     `gorm:"column:bulog_officer_id" json:"-"`
	MeasuredWeightKg float64   `gorm:"column:measured_weight_kg" json:"measuredWeightKg"`
	OcrWeightRaw     *string   `gorm:"column:ocr_weight_raw;size:50" json:"ocrWeightRaw,omitempty"`
	DeltaPercent     float64   `gorm:"column:delta_percent" json:"deltaPercent"`
	Status           string    `gorm:"column:status;size:20" json:"status"`
	RejectReason     *string   `gorm:"column:reject_reason;size:255" json:"rejectReason,omitempty"`
	BlockchainTxID   *string   `gorm:"column:blockchain_tx_id;size:128" json:"blockchainTxId,omitempty"`
	VerifiedAt       time.Time `gorm:"column:verified_at" json:"verifiedAt"`
}

func (Verification) TableName() string { return "verifications" }

type Allocation struct {
	ID              int64     `gorm:"primaryKey;column:id" json:"id"`
	HarvestRecordID int64     `gorm:"column:harvest_record_id" json:"-"`
	UreaKg          float64   `gorm:"column:urea_kg" json:"ureaKg"`
	NpkKg           float64   `gorm:"column:npk_kg" json:"npkKg"`
	OrganicKg       float64   `gorm:"column:organic_kg" json:"organicKg"`
	FormulaVersion  string    `gorm:"column:formula_version;size:20" json:"formulaVersion"`
	BlockchainTxID  *string   `gorm:"column:blockchain_tx_id;size:128" json:"blockchainTxId,omitempty"`
	CalculatedAt    time.Time `gorm:"column:calculated_at" json:"calculatedAt"`

	Harvest          *Harvest          `gorm:"foreignKey:HarvestRecordID" json:"-"`
	DistributionOrder *DistributionOrder `gorm:"foreignKey:AllocationID" json:"-"`
}

func (Allocation) TableName() string { return "allocations" }

type DistributionOrder struct {
	ID                  int64      `gorm:"primaryKey;column:id" json:"id"`
	AllocationID        int64      `gorm:"column:allocation_id" json:"-"`
	PihcAgentID         int64      `gorm:"column:pihc_agent_id" json:"-"`
	Status              string     `gorm:"column:status;size:20" json:"status"`
	DeliveryPhotoURL    *string    `gorm:"column:delivery_photo_url" json:"deliveryPhotoUrl,omitempty"`
	DistributionChainID string     `gorm:"column:distribution_chain_id;size:128" json:"distributionChainId"`
	BlockchainTxID      *string    `gorm:"column:blockchain_tx_id;size:128" json:"blockchainTxId,omitempty"`
	ScheduledDate       *time.Time `gorm:"column:scheduled_date" json:"scheduledDate,omitempty"`
	ActualDate          *time.Time `gorm:"column:actual_date" json:"actualDate,omitempty"`

	Allocation *Allocation `gorm:"foreignKey:AllocationID" json:"-"`
	Payment    *Payment    `gorm:"foreignKey:DistributionOrderID" json:"-"`
}

func (DistributionOrder) TableName() string { return "distribution_orders" }

type Payment struct {
	ID                  int64      `gorm:"primaryKey;column:id" json:"id"`
	DistributionOrderID int64      `gorm:"column:distribution_order_id" json:"-"`
	AmountIdr           int64      `gorm:"column:amount_idr" json:"amountIdr"`
	Status              string     `gorm:"column:status;size:20" json:"status"`
	KemenkeuRef         *string    `gorm:"column:kemenkeu_ref;size:50" json:"kemenkeuRef,omitempty"`
	BlockchainTxID      *string    `gorm:"column:blockchain_tx_id;size:128" json:"blockchainTxId,omitempty"`
	ProcessedAt         *time.Time `gorm:"column:processed_at" json:"processedAt,omitempty"`

	DistributionOrder *DistributionOrder `gorm:"foreignKey:DistributionOrderID" json:"-"`
}

func (Payment) TableName() string { return "payments" }

type Policy struct {
	ID             int64      `gorm:"primaryKey;column:id" json:"id"`
	PolicyName     string     `gorm:"column:policy_name;size:200" json:"policyName"`
	ProposedBy     *int64     `gorm:"column:proposed_by" json:"-"`
	ApprovedBy     *int64     `gorm:"column:approved_by" json:"-"`
	UreaCoeff      float64    `gorm:"column:urea_coeff" json:"ureaCoeff"`
	NpkCoeff       float64    `gorm:"column:npk_coeff" json:"npkCoeff"`
	OrganicCoeff   float64    `gorm:"column:organic_coeff" json:"organicCoeff"`
	BudgetCapIdr   int64      `gorm:"column:budget_cap_idr" json:"budgetCapIdr"`
	Status         string     `gorm:"column:status;size:20" json:"status"`
	PolicyChainID  string     `gorm:"column:policy_chain_id;size:128" json:"policyChainId"`
	BlockchainTxID *string    `gorm:"column:blockchain_tx_id;size:128" json:"blockchainTxId,omitempty"`
	EffectiveDate  *time.Time `gorm:"column:effective_date" json:"effectiveDate,omitempty"`
}

func (Policy) TableName() string { return "policies" }

type Notification struct {
	ID              int64     `gorm:"primaryKey;column:id" json:"id"`
	RecipientRole   string    `gorm:"column:recipient_role;size:20" json:"recipientRole"`
	RecipientUserID *int64    `gorm:"column:recipient_user_id" json:"recipientUserId,omitempty"`
	EventName       string    `gorm:"column:event_name;size:100" json:"eventName"`
	Title           string    `gorm:"column:title;size:200" json:"title"`
	Body            string    `gorm:"column:body" json:"body"`
	BlockchainTxID  *string   `gorm:"column:blockchain_tx_id;size:128" json:"blockchainTxId,omitempty"`
	IsRead          bool      `gorm:"column:is_read" json:"isRead"`
	CreatedAt       time.Time `gorm:"column:created_at" json:"createdAt"`
}

func (Notification) TableName() string { return "notifications" }

// LedgerEvent — event chaincode yang ditangkap listener (untuk feed Explorer & notifikasi).
type LedgerEvent struct {
	ID          int64     `gorm:"primaryKey;column:id" json:"id"`
	EventName   string    `gorm:"column:event_name;size:100" json:"eventName"`
	TxID        string    `gorm:"column:tx_id;size:128" json:"txId"`
	BlockNumber int64     `gorm:"column:block_number" json:"blockNumber"`
	PayloadJSON string    `gorm:"column:payload_json;type:nvarchar(max)" json:"-"`
	CreatedAt   time.Time `gorm:"column:created_at" json:"timestamp"`
}

func (LedgerEvent) TableName() string { return "ledger_events" }
