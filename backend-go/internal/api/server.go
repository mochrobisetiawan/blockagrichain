package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"gorm.io/gorm"

	"blockagrichain/backend/internal/auth"
	"blockagrichain/backend/internal/config"
	"blockagrichain/backend/internal/fabric"
	"blockagrichain/backend/internal/models"
	"blockagrichain/backend/internal/storage"
)

type Server struct {
	cfg  *config.Config
	db   *gorm.DB
	fab  *fabric.Manager
	auth *auth.Service
	s3   *storage.S3
}

func NewServer(cfg *config.Config, db *gorm.DB, fab *fabric.Manager, a *auth.Service) *Server {
	return &Server{
		cfg: cfg, db: db, fab: fab, auth: a,
		s3: storage.New(cfg.S3Bucket, cfg.S3Region, cfg.S3Endpoint, cfg.S3PublicBaseURL),
	}
}

// ChainProof — bukti blockchain seragam yang dikirim ke frontend.
type ChainProof struct {
	TxID        string `json:"txId"`
	BlockNumber uint64 `json:"blockNumber"`
	BlockHash   string `json:"blockHash"`
}

func proofOf(p *fabric.Proof) ChainProof {
	if p == nil {
		return ChainProof{}
	}
	return ChainProof{TxID: p.TxID, BlockNumber: p.BlockNumber, BlockHash: p.BlockHash}
}

func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   s.cfg.CorsOrigins,
		AllowedMethods:   []string{"GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type"},
		AllowCredentials: false,
	}))

	r.Route("/api", func(r chi.Router) {
		r.Get("/health", func(w http.ResponseWriter, _ *http.Request) { s.json(w, 200, map[string]string{"status": "ok"}) })
		r.Get("/public/network", s.publicNetwork) // status jaringan real untuk landing (tanpa auth)
		r.Post("/auth/login", s.login)

		// IoT ingest (ESP32-CAM kirim gambar timbangan) — Bearer JWT atau X-IoT-Key.
		r.Post("/iot/weight", s.iotWeight)
		// IoT kirim BERAT langsung (tanpa OCR) — Bearer JWT atau X-IoT-Key.
		r.Post("/iot-value/weight", s.iotWeightValue)

		r.Group(func(r chi.Router) {
			r.Use(s.auth.Middleware)
			r.Get("/auth/me", s.me)

			// Harvests
			r.Get("/harvests", s.listHarvests)
			r.With(auth.RequireRoles(models.RoleBulog)).Get("/harvests/pending", s.pendingHarvests)
			r.Get("/harvests/{id}", s.getHarvest)
			r.With(auth.RequireRoles(models.RoleFarmer)).Post("/harvests", s.submitHarvest)

			// Verifications
			r.With(auth.RequireRoles(models.RoleBulog)).Post("/verifications", s.submitVerification)

			// Distributions
			r.Get("/distributions", s.listDistributions)
			r.With(auth.RequireRoles(models.RolePihc)).Get("/distributions/ready", s.readyAllocations)
			r.With(auth.RequireRoles(models.RolePihc)).Post("/distributions", s.createDistribution)
			r.Patch("/distributions/{id}/status", s.updateDistributionStatus)

			// Payments
			r.Get("/payments", s.listPayments)
			r.With(auth.RequireRoles(models.RolePihc)).Post("/payments/request", s.requestPayment)
			r.With(auth.RequireRoles(models.RoleKemenkeu)).Post("/payments/{id}/approve", s.approvePayment)
			r.With(auth.RequireRoles(models.RoleKemenkeu)).Post("/payments/{id}/reject", s.rejectPayment)

			// Policies
			r.Get("/policies", s.listPolicies)
			r.Get("/policies/active", s.activePolicy)
			r.With(auth.RequireRoles(models.RoleKementan)).Post("/policies/propose", s.proposePolicy)
			r.With(auth.RequireRoles(models.RoleKemenkeu)).Post("/policies/{id}/approve", s.approvePolicy)

			// Farmers
			r.With(auth.RequireRoles(models.RoleFarmer)).Get("/farmers/me", s.farmerMe)
			r.With(auth.RequireRoles(models.RoleFarmer)).Patch("/farmers/me", s.updateFarmerMe)
			r.With(auth.RequireRoles(models.RoleFarmer)).Patch("/farmers/me/password", s.changePassword)
			r.With(auth.RequireRoles(models.RoleFarmer)).Post("/farmers/me/lands", s.addLand)
			r.With(auth.RequireRoles(models.RoleBulog, models.RoleKementan, models.RoleKemenkeu, models.RolePihc)).Get("/farmers", s.listFarmers)
			r.With(auth.RequireRoles(models.RoleKementan)).Post("/farmers", s.createFarmer)
			r.With(auth.RequireRoles(models.RoleKementan)).Post("/farmers/{id}/disable", s.disableFarmer)

			// IoT image proxy (Bulog lihat foto timbangan dari S3 privat)
			r.With(auth.RequireRoles(models.RoleBulog)).Get("/iot/image/{id}", s.iotImage)
			r.With(auth.RequireRoles(models.RoleBulog)).Get("/harvests/{id}/photo", s.harvestPhoto)

			// Notifications
			r.Get("/notifications", s.listNotifications)
			r.Post("/notifications/{id}/read", s.markNotificationRead)

			// Upload object storage off-chain (S3) — presigned PUT URL
			r.Post("/uploads/presign", s.presignUpload)

			// Dashboard
			r.Get("/dashboard/stats", s.dashboardStats)

			// Ledger / Blockchain Explorer
			r.Get("/ledger/blocks", s.ledgerBlocks)
			r.Get("/ledger/events", s.ledgerEvents)
			r.Get("/ledger/history/{objectType}/{objectId}", s.ledgerHistory)
			r.Get("/ledger/state/{objectType}/{objectId}", s.ledgerState)
			r.Post("/ledger/verify-hash", s.verifyHash)
			r.Get("/ledger/integrity", s.ledgerIntegrity)
		})
	})
	return r
}

// ── Helper response/JSON ──

func (s *Server) json(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	if v != nil {
		_ = json.NewEncoder(w).Encode(v)
	}
}

func (s *Server) bad(w http.ResponseWriter, msg string) {
	s.json(w, http.StatusBadRequest, map[string]any{"error": msg})
}

func (s *Server) notFound(w http.ResponseWriter, msg string) {
	s.json(w, http.StatusNotFound, map[string]any{"error": msg})
}

// fail — petakan error chaincode → 403 (akses) / 400 (bisnis); selain itu 500.
func (s *Server) fail(w http.ResponseWriter, err error) {
	if ce, ok := err.(*fabric.ChainError); ok {
		code := http.StatusBadRequest
		if ce.AccessDenied {
			code = http.StatusForbidden
		}
		s.json(w, code, map[string]any{"error": ce.Msg, "accessDenied": ce.AccessDenied})
		return
	}
	s.json(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
}

func decode(r *http.Request, dst any) error {
	return json.NewDecoder(r.Body).Decode(dst)
}

// notify — tulis notifikasi off-chain (≈ Notify.Add C#).
func (s *Server) notify(role, event, title, body, txID string, userID *int64) {
	var tx *string
	if txID != "" {
		tx = &txID
	}
	s.db.Create(&models.Notification{
		RecipientRole: role, RecipientUserID: userID, EventName: event,
		Title: title, Body: body, BlockchainTxID: tx, CreatedAt: time.Now(),
	})
}

func chainID(prefix string, seq int64) string { return fmt.Sprintf("%s-%04d", prefix, seq) }
