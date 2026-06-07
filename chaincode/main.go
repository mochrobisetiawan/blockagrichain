package main

import (
	"log"
	"os"

	"github.com/hyperledger/fabric-chaincode-go/shim"
	"github.com/hyperledger/fabric-contract-api-go/contractapi"
)

// Entry point chaincode BlockAgriChain (Go Chaincode — sesuai DPPL).
//
// Mendukung dua mode:
//   1. CCaaS / Chaincode-as-a-Service (WAJIB di ECS Fargate, karena peer tidak
//      bisa men-spawn container chaincode). Aktif bila env CHAINCODE_SERVER_ADDRESS di-set.
//   2. Mode klasik (launched-by-peer) — untuk docker-compose/dev biasa.
func main() {
	cc, err := contractapi.NewChaincode(&BlockAgriContract{})
	if err != nil {
		log.Panicf("gagal membuat chaincode BlockAgriChain: %v", err)
	}

	addr := os.Getenv("CHAINCODE_SERVER_ADDRESS")
	if addr != "" {
		// ── Mode CCaaS (Fargate / external builder) ──
		server := &shim.ChaincodeServer{
			CCID:    os.Getenv("CHAINCODE_ID"),
			Address: addr,
			CC:      cc,
			TLSProps: shim.TLSProperties{
				// TLS antar peer↔chaincode di-handle di level jaringan VPC/Cloud Map.
				// Untuk produksi nyata bisa diaktifkan dengan sertifikat khusus.
				Disabled: true,
			},
		}
		log.Printf("BlockAgriChain chaincode (CCaaS) listening on %s, CCID=%s", addr, server.CCID)
		if err := server.Start(); err != nil {
			log.Panicf("gagal menjalankan chaincode server: %v", err)
		}
		return
	}

	// ── Mode klasik (launched-by-peer) ──
	if err := cc.Start(); err != nil {
		log.Panicf("gagal menjalankan chaincode BlockAgriChain: %v", err)
	}
}
