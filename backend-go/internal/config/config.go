package config

import (
	"os"
	"strconv"
	"strings"
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

		// Default = port docker-compose lokal; override via env saat di Fargate.
		PeerEndpoints: map[string]string{
			"PetaniMSP":   get("FABRIC_PETANI_PEER", "localhost:7051"),
			"BulogMSP":    get("FABRIC_BULOG_PEER", "localhost:8051"),
			"KementanMSP": get("FABRIC_KEMENTAN_PEER", "localhost:9051"),
			"KemenkeuMSP": get("FABRIC_KEMENKEU_PEER", "localhost:10051"),
			"PIHCMSP":     get("FABRIC_PIHC_PEER", "localhost:11051"),
		},
	}
	return c
}
