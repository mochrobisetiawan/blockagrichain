package main

import (
	"context"
	"log"
	"net/http"
	"time"

	"blockagrichain/backend/internal/api"
	"blockagrichain/backend/internal/auth"
	"blockagrichain/backend/internal/config"
	"blockagrichain/backend/internal/fabric"
	"blockagrichain/backend/internal/models"
	"blockagrichain/backend/internal/store"
)

func main() {
	cfg := config.Load()

	db, err := store.Open(cfg)
	if err != nil {
		log.Fatalf("koneksi database gagal: %v", err)
	}
	log.Println("✅ Database terhubung & migrasi selesai")

	fab := fabric.New(cfg)
	defer fab.Close()

	// Seed (perlu jaringan Fabric siap) — retry agar tahan urutan startup.
	for i := 1; i <= 12; i++ {
		if err := store.Seed(db, fab); err != nil {
			log.Printf("seed percobaan %d/12 gagal (menunggu Fabric siap): %v", i, err)
			time.Sleep(6 * time.Second)
			continue
		}
		break
	}

	// Listener event chaincode → simpan ke feed Explorer (ledger_events).
	go func() {
		for {
			err := fab.ListenEvents(context.Background(), func(name, txID string, block uint64, payload []byte) {
				db.Create(&models.LedgerEvent{
					EventName: name, TxID: txID, BlockNumber: int64(block),
					PayloadJSON: string(payload), CreatedAt: time.Now(),
				})
			})
			if err != nil {
				log.Printf("listener event terputus, mencoba lagi: %v", err)
				time.Sleep(5 * time.Second)
			}
		}
	}()

	srv := api.NewServer(cfg, db, fab, auth.New(cfg))

	log.Printf("🚀 BlockAgriChain API (Go) listening on :%s", cfg.Port)
	if err := http.ListenAndServe(":"+cfg.Port, srv.Router()); err != nil {
		log.Fatalf("server berhenti: %v", err)
	}
}
