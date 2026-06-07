package store

import (
	"fmt"
	"log"
	"net/url"
	"strconv"
	"time"

	"gorm.io/driver/sqlserver"
	"gorm.io/gorm"

	"blockagrichain/backend/internal/auth"
	"blockagrichain/backend/internal/config"
	"blockagrichain/backend/internal/fabric"
	"blockagrichain/backend/internal/models"
)

const DemoPassword = "password123"

// ensureDatabase — buat database target bila belum ada (SQL Server tak auto-create lewat AutoMigrate).
func ensureDatabase(dsn string) error {
	u, err := url.Parse(dsn)
	if err != nil {
		return err
	}
	q := u.Query()
	name := q.Get("database")
	if name == "" {
		return nil
	}
	q.Set("database", "master")
	u.RawQuery = q.Encode()
	master, err := gorm.Open(sqlserver.Open(u.String()), &gorm.Config{})
	if err != nil {
		return err
	}
	if sqlDB, e := master.DB(); e == nil {
		defer sqlDB.Close()
	}
	return master.Exec(fmt.Sprintf("IF DB_ID(N'%s') IS NULL CREATE DATABASE [%s]", name, name)).Error
}

// Open — koneksi SQL Server (RDBMS off-chain sesuai DPPL) + AutoMigrate seluruh tabel.
func Open(cfg *config.Config) (*gorm.DB, error) {
	// Coba buat database bila belum ada. Di RDS terkelola, login sering TIDAK punya
	// izin CREATE DATABASE / akses ke 'master' — itu OK selama database target sudah
	// disiapkan DBA. Jadi kegagalan di sini hanya peringatan, bukan fatal.
	if err := ensureDatabase(cfg.DatabaseURL); err != nil {
		log.Printf("⚠️  Lewati pembuatan database (asumsikan sudah ada): %v", err)
	}
	db, err := gorm.Open(sqlserver.Open(cfg.DatabaseURL), &gorm.Config{})
	if err != nil {
		return nil, err
	}
	if err := db.AutoMigrate(
		&models.User{}, &models.Farmer{}, &models.FarmLand{}, &models.Harvest{},
		&models.Verification{}, &models.Allocation{}, &models.DistributionOrder{},
		&models.Payment{}, &models.Policy{}, &models.Notification{}, &models.LedgerEvent{},
	); err != nil {
		return nil, err
	}
	return db, nil
}

// Seed — data demo (1 akun per role, profil petani, registrasi on-chain, kebijakan aktif).
// Idempotent: hanya jalan saat tabel users kosong. Memerlukan jaringan Fabric sudah siap.
func Seed(db *gorm.DB, fab *fabric.Manager) error {
	var n int64
	db.Model(&models.User{}).Count(&n)
	if n > 0 {
		return nil
	}

	mkUser := func(username, role string) (*models.User, error) {
		msp := models.MSPForRole(role)
		cn, err := fab.ClientCN(msp) // FabricClientId = CN sertifikat org (User1@<domain>)
		if err != nil {
			return nil, fmt.Errorf("ambil identitas %s: %w", msp, err)
		}
		u := &models.User{
			Username: username, Email: username + "@blockagrichain.id",
			PasswordHash: auth.HashPassword(DemoPassword), Role: role,
			MspID: msp, FabricClientID: cn, IsActive: true, CreatedAt: time.Now(),
		}
		if err := db.Create(u).Error; err != nil {
			return nil, err
		}
		return u, nil
	}

	farmer, err := mkUser("budi", models.RoleFarmer)
	if err != nil {
		return err
	}
	if _, err := mkUser("bulog", models.RoleBulog); err != nil {
		return err
	}
	kementan, err := mkUser("kementan", models.RoleKementan)
	if err != nil {
		return err
	}
	kemenkeu, err := mkUser("kemenkeu", models.RoleKemenkeu)
	if err != nil {
		return err
	}
	if _, err := mkUser("pihc", models.RolePihc); err != nil {
		return err
	}

	// Profil petani (PII off-chain) + lahan
	group := "Tani Makmur"
	phone := "081234567890"
	addr := "Desa Ciawi, Bogor, Jawa Barat"
	bd := time.Date(1985, 5, 17, 0, 0, 0, 0, time.UTC)
	farmerChainID := fmt.Sprintf("F-%04d", farmer.ID)
	nik := "3201234567890001"
	profile := &models.Farmer{
		UserID: farmer.ID, Nik: nik, FullName: "Budi Santoso", Phone: &phone,
		FarmerGroup: &group, FarmerChainID: farmerChainID, BirthDate: &bd, AddressDetail: &addr,
	}
	if err := db.Create(profile).Error; err != nil {
		return err
	}
	lat, lng := -6.6500, 106.8400
	if err := db.Create(&models.FarmLand{
		FarmerID: profile.ID, LandAreaHa: 1.2, Village: "Ciawi", District: "Ciawi",
		Province: "Jawa Barat", GpsLat: &lat, GpsLng: &lng, IsPrimary: true,
	}).Error; err != nil {
		return err
	}

	// ── On-chain: registrasi petani (identitas petani sendiri) ──
	if _, _, err := fab.Submit(farmer.MspID, "RegisterFarmer",
		farmerChainID, farmer.FabricClientID, auth.Sha256Hex(nik), "12000", "JABAR"); err != nil {
		return fmt.Errorf("RegisterFarmer on-chain: %w", err)
	}

	// ── On-chain: kebijakan (Kementan usulkan → Kemenkeu setujui) ──
	policyChainID := "POL-2026-001"
	effective := strconv.FormatInt(time.Now().Unix(), 10)
	budgetCents := strconv.FormatInt(6_000_000_000_000*100, 10)
	if _, _, err := fab.Submit(kementan.MspID, "ProposePolicy",
		policyChainID, "Kebijakan Subsidi Pupuk Q2 2026", auth.Sha256Hex("kebijakan-subsidi-q2-2026"),
		"500", "350", "240", budgetCents, effective); err != nil {
		return fmt.Errorf("ProposePolicy on-chain: %w", err)
	}
	if _, _, err := fab.Submit(kemenkeu.MspID, "ApprovePolicy", policyChainID); err != nil {
		return fmt.Errorf("ApprovePolicy on-chain: %w", err)
	}

	// Mirror kebijakan off-chain
	effDate := time.Now()
	if err := db.Create(&models.Policy{
		PolicyName: "Kebijakan Subsidi Pupuk Q2 2026", ProposedBy: &kementan.ID, ApprovedBy: &kemenkeu.ID,
		UreaCoeff: 50, NpkCoeff: 35, OrganicCoeff: 24, BudgetCapIdr: 6_000_000_000_000,
		Status: models.PolicyActive, PolicyChainID: policyChainID, EffectiveDate: &effDate,
	}).Error; err != nil {
		return err
	}

	log.Println("✅ Seed selesai: 5 akun + petani 'budi' + kebijakan aktif (on-chain).")
	return nil
}
