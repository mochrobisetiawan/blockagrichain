# Deploy BlockAgriChain ke satu instance EC2

Cara paling sederhana & andal: **semua jalan di 1 EC2** (Fabric peer/orderer punya disk
persisten bawaan EC2, jadi tak perlu EFS/Cloud Map). Frontend, backend Go, chaincode, dan
SQL Server jalan sebagai container di host yang sama.

## Spesifikasi lengkap yang dideploy (14 container)

| # | Komponen | Image | Peran | Port | State | Acuan SKPL/DPPL |
|---|---|---|---|---|---|---|
| 1 | `orderer.blockagri.id` | `hyperledger/fabric-orderer:2.5` | Ordering service **Raft (CFT)** — konsensus **EOV** | 7050, 7053 | stateful (vol) | SKPL 3.3 (EOV, Raft CFT) |
| 2 | `peer0.petani` | `hyperledger/fabric-peer:2.5` | Peer org **PetaniMSP** (endorse/commit) | 7051 | stateful (vol) + TLS | DPPL Validator/MSP |
| 3 | `peer0.bulog` | `hyperledger/fabric-peer:2.5` | Peer org **BulogMSP** (validator) | 8051 | stateful (vol) + TLS | SKPL/DPPL validator |
| 4 | `peer0.kementan` | `hyperledger/fabric-peer:2.5` | Peer org **KementanMSP** (validator) | 9051 | stateful (vol) + TLS | SKPL/DPPL validator |
| 5 | `peer0.kemenkeu` | `hyperledger/fabric-peer:2.5` | Peer org **KemenkeuMSP** | 10051 | stateful (vol) + TLS | DPPL MSP |
| 6 | `peer0.pihc` | `hyperledger/fabric-peer:2.5` | Peer org **PIHCMSP** (validator) | 11051 | stateful (vol) + TLS | SKPL/DPPL validator |
| 7–11 | `couchdb0`–`couchdb4` | `couchdb:3.3` | **World State Database** (1/peer) | 5984–5988 | stateful | DPPL V.3 (World State = CouchDB) |
| 12 | `chaincode.blockagri.id` | `blockagri/chaincode` (Go, **CCaaS**) | **Smart contract** (14 fungsi bab V) | 9999 | stateless | DPPL bab V (**Go Chaincode**) |
| 13 | `mssql` | `mcr.microsoft.com/mssql/server:2022` | **RDBMS off-chain** (PII, biodata, notifikasi) | 1433 | stateful (vol) | DPPL ("**SQLServer sebagai RDBMS utama**") |
| 14 | `backend` | `blockagri/backend` (Go) | **Application Server / API Gateway** + Fabric Gateway client (JWT, RBAC per-MSP) | 8080 | stateless | SKPL 3.3/3.4 (API Gateway) |
| 15 | `frontend` | `blockagri/frontend` (nginx + React) | UI 5 peran | 8081→80 | stateless | SKPL 3.1 (UI/UX) |

**Keamanan transport:** TLS aktif pada seluruh komunikasi peer/orderer (SKPL 3.4 — TLS).
**Identitas:** MSP berbasis **X.509** (cryptogen), bukan wallet — sesuai DPPL.
**Pemisahan data:** on-chain (hash, ID, status, kuota) di CouchDB World State; off-chain (NIK→hanya SHA-256, biodata, foto-URL) di SQL Server — DPPL bab I.4.

> **Object storage S3 (off-chain, sesuai DPPL):** foto bukti panen/serah terima/profil
> diunggah **langsung ke S3** dari browser via *presigned PUT URL*; **URL**-nya disimpan di
> SQL Server dan hanya **hash SHA-256** yang masuk ledger. Lihat **Setup S3** di bawah.

## Setup S3 (off-chain object storage)
1. **Buat bucket** (mis. `blockagri-uploads`) di region yang sama dengan EC2.
2. **IAM role EC2** (disarankan, tanpa kunci statis) dengan izin minimal
   `s3:PutObject` + `s3:GetObject` pada `arn:aws:s3:::blockagri-uploads/*`; lampirkan ke instance.
3. **CORS bucket** (agar browser bisa PUT) — Permissions → CORS:
   ```json
   [{"AllowedMethods":["PUT","GET"],"AllowedOrigins":["http://<IP_PUBLIK_EC2>:8081"],
     "AllowedHeaders":["*"],"ExposeHeaders":["ETag"],"MaxAgeSeconds":3000}]
   ```
4. **Set env lalu jalankan**:
   ```bash
   export S3_BUCKET=blockagri-uploads
   export S3_REGION=ap-southeast-1
   docker compose -f deploy/docker-compose.app.yml up -d --build
   ```
   `S3_BUCKET` kosong → fitur unggah nonaktif & UI memakai URL manual (alur tetap sesuai DPPL).
   Endpoint backend: `POST /api/uploads/presign` → `{ uploadUrl, objectUrl }`.

## 1. Siapkan EC2
- **AMI**: Ubuntu 22.04/24.04. **Tipe**: minimal `t3.large` (2 vCPU/8 GB) — Fabric + SQL Server cukup berat.
- **Storage**: ≥ 30 GB.
- **Security Group** (inbound):
  | Port | Untuk |
  |---|---|
  | 22 | SSH |
  | 8081 | Frontend (nginx) |
  | 8080 | API (opsional, kalau diakses langsung) |

  Port Fabric (7050/7051/…) **tidak perlu** dibuka publik — semua komunikasi internal antar-container.

## 2. Pasang Docker
```bash
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-plugin git curl
sudo usermod -aG docker $USER && newgrp docker
```

## 3. Ambil kode & jalankan
```bash
git clone <repo-anda> blockagrichain   # atau scp folder Project/
cd blockagrichain/Project
bash deploy/up-ec2.sh
```
Skrip otomatis: unduh binari Fabric → `network.sh up` (crypto, channel, chaincode) →
naikkan SQL Server + backend + frontend.

> Catatan: `go mod tidy` dijalankan otomatis di dalam Docker build (chaincode & backend),
> jadi versi dependency terkunci saat build pertama. Build awal agak lama (unduh image + modul Go).

## 4. Akses
- Frontend: `http://<IP_PUBLIK_EC2>:8081`
- Login: `budi` / `password123` (atau `bulog`, `kementan`, `kemenkeu`, `pihc`).

## 5. Operasional
```bash
# Lihat log
docker compose -f deploy/docker-compose.app.yml logs -f backend
docker logs -f peer0.petani.blockagri.id

# Hentikan app (Fabric tetap jalan)
docker compose -f deploy/docker-compose.app.yml down

# Hentikan & bersihkan jaringan Fabric
cd fabric && ./network.sh down
```

## Catatan produksi
- Ganti `MSSQL_SA_PASSWORD` & `JWT_KEY` (jangan pakai default).
- Pertimbangkan **RDS for SQL Server** alih-alih container SQL Server agar data DB lebih aman/terkelola.
- Taruh **Nginx/ALB + HTTPS** di depan port 8081.

> Ingin lepas dari satu titik kegagalan (skala/HA)? Lihat `README-ECS.md` untuk varian
> hybrid (app di Fargate, Fabric tetap di EC2) atau full Fargate (EFS + Cloud Map).
