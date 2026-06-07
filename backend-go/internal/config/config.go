package config

import (
	"context"
	"log"
	"os"
	"strconv"
	"strings"

	"blockagrichain/backend/internal/secrets"
)

// Config — seluruh konfigurasi runtime dari environment (12-factor, cocok untuk Fargate).
type Config struct {
	Port        string
	DatabaseURL string

	JWTKey           string
	JWTIssuer        string
	JWTAudience      string
	JWTExpiryMinutes int

	CorsOrigins []string

	FabricChannel    string
	FabricChaincode  string
	FabricCryptoPath string // path ke direktori 'organizations' hasil cryptogen

	// Object storage off-chain (S3) — foto bukti panen/serah terima/profil (DPPL).
	S3Bucket        string
	S3Region        string
	S3Endpoint      string // kosong = AWS S3; isi untuk MinIO / endpoint kustom
	S3PublicBaseURL string // opsional override base URL publik object

	// AWS Secrets Manager — name/ARN secret berisi JSON rahasia (DSN DB, JWT, dll).
	// Bila di-set, nilai dari secret menimpa env/default. Pakai IAM role (tanpa .env).
	AWSSecretID string

	// Endpoint peer gateway per org (di Fargate = nama AWS Cloud Map).
	PeerEndpoints map[string]string
}

func get(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func Load() *Config {
	expiry, _ := strconv.Atoi(get("JWT_EXPIRY_MINUTES", "480"))

	c := &Config{
		Port:        get("PORT", "8080"),
		DatabaseURL: get("DATABASE_URL", "sqlserver://sa:Blockagri_Strong!Pass1@localhost:1433?database=blockagri&encrypt=disable"),

		JWTKey:           get("JWT_KEY", "ganti-rahasia-ini-di-produksi-minimal-32-karakter"),
		JWTIssuer:        get("JWT_ISSUER", "BlockAgriChain"),
		JWTAudience:      get("JWT_AUDIENCE", "BlockAgriChain"),
		JWTExpiryMinutes: expiry,

		CorsOrigins: strings.Split(get("CORS_ORIGINS", "http://localhost:5173"), ","),

		FabricChannel:    get("FABRIC_CHANNEL", "blockagri"),
		FabricChaincode:  get("FABRIC_CHAINCODE", "blockagri"),
		FabricCryptoPath: get("FABRIC_CRYPTO_PATH", "../fabric/organizations"),

		S3Bucket:        get("S3_BUCKET", ""),
		S3Region:        get("S3_REGION", get("AWS_REGION", "ap-southeast-1")),
		S3Endpoint:      get("S3_ENDPOINT", ""),
		S3PublicBaseURL: get("S3_PUBLIC_BASE_URL", ""),

		AWSSecretID: get("AWS_SECRET_ID", get("SECRETS_MANAGER_ID", "")),

		// Default = port docker-compose lokal; override via env saat di Fargate.
		PeerEndpoints: map[string]string{
			"PetaniMSP":   get("FABRIC_PETANI_PEER", "localhost:7051"),
			"BulogMSP":    get("FABRIC_BULOG_PEER", "localhost:8051"),
			"KementanMSP": get("FABRIC_KEMENTAN_PEER", "localhost:9051"),
			"KemenkeuMSP": get("FABRIC_KEMENKEU_PEER", "localhost:10051"),
			"PIHCMSP":     get("FABRIC_PIHC_PEER", "localhost:11051"),
		},
	}

	// Timpa nilai sensitif dari AWS Secrets Manager bila dikonfigurasi.
	c.applySecrets()
	return c
}

// applySecrets — ambil JSON rahasia dari AWS Secrets Manager dan timpa field
// yang cocok. Gagal memuat tidak fatal (fallback ke env/default) supaya dev lokal
// (tanpa AWS) tetap jalan.
func (c *Config) applySecrets() {
	if c.AWSSecretID == "" {
		return
	}
	m, err := secrets.Fetch(context.Background(), c.S3Region, c.AWSSecretID)
	if err != nil {
		log.Printf("⚠️  AWS Secrets Manager (%s) gagal dimuat: %v — memakai env/default", c.AWSSecretID, err)
		return
	}
	setIf(m, "DATABASE_URL", &c.DatabaseURL)
	setIf(m, "JWT_KEY", &c.JWTKey)
	setIf(m, "JWT_ISSUER", &c.JWTIssuer)
	setIf(m, "JWT_AUDIENCE", &c.JWTAudience)
	setIf(m, "S3_BUCKET", &c.S3Bucket)
	setIf(m, "S3_REGION", &c.S3Region)
	setIf(m, "S3_ENDPOINT", &c.S3Endpoint)
	setIf(m, "S3_PUBLIC_BASE_URL", &c.S3PublicBaseURL)
	if v, ok := m["CORS_ORIGINS"]; ok && v != "" {
		c.CorsOrigins = strings.Split(v, ",")
	}
	log.Printf("🔐 Memuat %d rahasia dari AWS Secrets Manager (%s)", len(m), c.AWSSecretID)
}

func setIf(m map[string]string, key string, dst *string) {
	if v, ok := m[key]; ok && v != "" {
		*dst = v
	}
}
