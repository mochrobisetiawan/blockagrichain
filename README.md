# BlockAgriChain — Full Stack (Hyperledger Fabric asli)

Implementasi sistem **Blockchain Alokasi Pupuk Subsidi** sesuai **SKPL** & **DPPL**
(Mata Kuliah Teknologi Blockchain KOM2635, IPB University) — **menggunakan Hyperledger
Fabric asli dengan Go Chaincode**, dirancang untuk dijalankan/di-deploy ke **AWS (ECS Fargate)**.

Alur hulu→hilir: **Petani** lapor panen → **Bulog** verifikasi fisik (IoT/OCR + HSM) →
*smart contract* hitung alokasi otomatis → **PIHC** distribusi → **Kemenkeu** cairkan subsidi,
dengan **Kementan** pembuat kebijakan. Semua transaksi immutable & dapat diaudit.

## Arsitektur

| Lapisan | Teknologi | Lokasi |
|---|---|---|
| Frontend | React 19 + Vite + TypeScript | `frontend/` |
| Backend / API Gateway | **Go** (chi) + JWT, Fabric Gateway SDK **resmi**, **SQL Server** (GORM) | `backend-go/` |
| Smart Contract | **Go Chaincode** (Hyperledger Fabric, CCaaS) | `chaincode/` |
| Jaringan Blockchain | **Hyperledger Fabric 2.5** asli — 5 org MSP + orderer Raft, **World State = CouchDB** | `fabric/` |
| Object Storage off-chain | **Amazon S3** — foto bukti panen/serah terima/profil (unggah *presigned URL*) | `backend-go/internal/storage` |
| Deploy | Dockerfile tiap service + EC2 (utama) / ECS (opsional) | `deploy/` |

> **Catatan bahasa (sesuai dokumen):** DPPL mewajibkan **Go Chaincode**; bahasa Application
> Server tidak ditentukan dokumen. Stack ini memakai **Go end-to-end** (chaincode + backend)
> dengan **Fabric Gateway SDK resmi**.

### Pemisahan On-Chain vs Off-Chain (DPPL bab I.4)
- **On-chain** (ledger Fabric): hash dokumen, ID petani, status verifikasi, kuota alokasi, audit.
- **Off-chain — SQL Server** (RDBMS utama sesuai DPPL): PII (NIK, biodata), GPS, notifikasi,
  serta **URL** foto. NIK **tidak pernah** masuk ledger — hanya `SHA-256(NIK)`.
- **Off-chain — Amazon S3**: file biner foto/dokumen (bukti panen, serah terima, profil).
  File diunggah klien via *presigned PUT*; hanya **SHA-256** file yang masuk ledger.

### Lima MSP (1:1 dengan peran)
`PetaniMSP · BulogMSP · KementanMSP · KemenkeuMSP · PIHCMSP` + `OrdererMSP`.
Kontrol akses (RBAC) ditegakkan di chaincode berdasarkan **MSP sertifikat pengirim** transaksi.

## Menjalankan (lokal/EC2 ber-Docker)

> Mesin **harus** punya Docker + binari Fabric. Di Windows gunakan WSL2/EC2 Ubuntu.

```bash
# 0. Pasang binari + image Fabric (sekali)
curl -sSL https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh | bash -s -- binary docker
export PATH=$PWD/fabric/bin:$PATH
export FABRIC_CFG_PATH=$PWD/fabric/config

# 1. Naikkan jaringan Fabric + chaincode (crypto, channel, install/approve/commit)
cd fabric && ./network.sh up && cd ..

# 2. Naikkan Postgres + backend Go + frontend
cd deploy && docker compose -f docker-compose.app.yml up -d --build
```
Frontend: `http://localhost:8081` · API: `http://localhost:8080`.

Mode dev frontend (hot reload): `cd frontend && npm install && npm run dev` (proxy `/api` → `:8080`).

## Deploy ke AWS

- **EC2 (disarankan, paling sederhana):** semua di 1 instance — `bash deploy/up-ec2.sh`.
  Panduan lengkap: **[deploy/README-EC2.md](deploy/README-EC2.md)**.
- **ECS Fargate (opsional, lanjutan):** app stateless di Fargate, Fabric tetap di EC2 (hybrid)
  atau full Fargate (EFS + Cloud Map). Lihat **[deploy/README-ECS.md](deploy/README-ECS.md)**.

## Akun Demo (password: `password123`)
| Username | Role | MSP |
|---|---|---|
| `budi` | Petani | PetaniMSP |
| `bulog` | Bulog (validator) | BulogMSP |
| `kementan` | Kementerian Pertanian | KementanMSP |
| `kemenkeu` | Kementerian Keuangan | KemenkeuMSP |
| `pihc` | Pupuk Indonesia | PIHCMSP |

## Alur Demo End-to-End
1. **budi** → Input Panen (foto di-hash SHA-256 di klien, hanya hash ke ledger).
2. **bulog** → Antrian Verifikasi → berat IoT → **Approve** (HSM) → alokasi dihitung otomatis chaincode.
3. **pihc** → Distribusi → Buat Order → Kirim → Tandai Terkirim.
4. **budi** → **Konfirmasi Terima** (hanya petani penerima — ditegakkan chaincode MSP+ownership).
5. **pihc** → Ajukan Klaim subsidi.
6. **kemenkeu** → **Cairkan**.
7. Siapa pun → **Blockchain Explorer** → **Verifikasi Integritas** (rantai blok native Fabric).

## Fungsi Chaincode (DPPL bab V) — `chaincode/`
`RegisterFarmer`, `SubmitHarvest`, `SubmitVerification` (→ auto `CalculateAllocation`),
`ProposePolicy`/`ApprovePolicy`, `CreateDistribution`/`UpdateDistributionStatus`,
`RequestPayment`/`ApprovePayment`/`RejectPayment`, `DisableFarmer`, plus query
(`GetFarmer`, `GetHarvestById`, …, `GetState`, `GetTransactionHistory`).

## Empat Elemen Wajib Aplikasi Blockchain (DPPL bab IV)
- **Connection Status**: indikator `Terhubung · <MSP>` di topbar.
- **Transaction Feedback**: toast + notifikasi event real-time.
- **Blockchain Evidence**: TxID + Block Number + Block Hash pada tiap aksi.
- **Verification Tool**: menu **Cek Hash** + **Verifikasi Integritas** (blok native Fabric).
