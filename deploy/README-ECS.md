# Deploy BlockAgriChain ke AWS (ECS Fargate)

Panduan ini men-deploy seluruh sistem (Hyperledger Fabric asli + chaincode Go + backend Go + frontend) ke AWS dengan **ECS Fargate**.

## Penting dibaca dulu — topologi yang realistis

Komponen sistem terbagi dua sifat:

| Komponen | Sifat | Fargate? |
|---|---|---|
| Frontend (nginx), Backend (Go), Chaincode (CCaaS) | **stateless** | ✅ Sangat cocok Fargate |
| Fabric peer / orderer / (CA) | **stateful** (ledger, gossip antar-node, DNS stabil) | ⚠️ Bisa, tapi butuh **EFS + Cloud Map** dan paling rumit |

Karena itu chaincode sudah dibuat **CCaaS** (peer di Fargate tak bisa men-spawn container chaincode), dan ada **dua pilihan deploy**:

- **Pilihan A — Hybrid (disarankan, paling andal):** jaringan Fabric (5 peer + orderer) jalan di **1 instance EC2** via `fabric/network.sh up`; frontend + backend + chaincode jalan di **Fargate**. Backend menjangkau peer EC2 lewat DNS privat/Cloud Map. Paling cepat berhasil.
- **Pilihan B — Full Fargate:** semua termasuk peer/orderer sebagai task Fargate dengan **EFS** (persisten ledger) + **Cloud Map** (DNS antar-node). Paling "murni cloud", paling banyak konfigurasi.

Langkah di bawah memakai pondasi yang sama; bagian Fabric menandai mana yang khusus A atau B.

---

## 0. Prasyarat
- AWS CLI terkonfigurasi, Docker, dan akses membuat VPC/ECS/EFS/RDS/Cloud Map.
- Sudah memilih `AWS_REGION` & `AWS_ACCOUNT`.

## 1. Build & push image ke ECR
```bash
cd Project/deploy
AWS_REGION=ap-southeast-3 AWS_ACCOUNT=123456789012 ./push-ecr.sh
```
Menghasilkan: `blockagri/chaincode`, `blockagri/backend`, `blockagri/frontend`.

## 2. Jaringan & layanan dasar
1. **VPC** dengan minimal 2 subnet privat + 1 subnet publik (untuk ALB).
2. **AWS Cloud Map** namespace privat `blockagri.id` (DNS internal). Daftarkan service:
   `orderer`, `peer0.petani`, `peer0.bulog`, `peer0.kementan`, `peer0.kemenkeu`, `peer0.pihc`, `chaincode`, `backend`.
   > Nama DNS ini **wajib sama** dengan domain di `fabric/crypto-config.yaml` agar sertifikat TLS valid.
3. **RDS PostgreSQL** (`blockagri`), simpan endpoint untuk `DATABASE_URL`.
4. **EFS** untuk materi kripto Fabric (`organizations/`) — mount ke backend (read-only) dan, pada Pilihan B, ke peer/orderer.

## 3. Materi kripto (cryptogen) sekali saja
Di host mana pun ber-Fabric-binary:
```bash
cd Project/fabric
cryptogen generate --config=crypto-config.yaml --output=organizations
```
Unggah folder `organizations/` ke **EFS** (mis. via instance bastion yang m-mount EFS, atau DataSync).

## 4. Jaringan Fabric

### Pilihan A (EC2) — disarankan
1. Jalankan 1 instance EC2 (Ubuntu, Docker terpasang) di subnet privat.
2. Salin folder `Project/fabric` ke EC2, pasang binari Fabric, lalu:
   ```bash
   ./network.sh up
   ```
3. Daftarkan IP privat EC2 ke record Cloud Map `peer0.*` & `orderer` (atau jalankan EC2 di subnet yang sama dan pakai /etc/hosts/Route53 privat).

### Pilihan B (Fargate)
1. Buat ECS service untuk **orderer** dan tiap **peer0.\*** memakai image resmi `hyperledger/fabric-orderer:2.5` / `fabric-peer:2.5`, env sesuai `fabric/compose/compose-net.yaml`, mount **EFS** untuk `production/` (ledger) dan materi kripto.
2. Hubungkan tiap task ke service Cloud Map yang sesuai (DNS stabil).
3. Buat channel & join peer (jalankan `osnadmin`/`peer channel` dari task bastion atau CodeBuild yang punya binari Fabric + akses VPC).
4. Deploy **chaincode** sebagai service Fargate (`chaincode.taskdef.json`), set `CHAINCODE_ID` = package ID.
5. Install/approve/commit chaincode (lihat `fabric/network.sh` bagian `installApproveCommit`).

## 5. Deploy chaincode (CCaaS)
- Daftarkan `deploy/ecs/chaincode.taskdef.json` (isi `CHAINCODE_ID` dari `peer lifecycle chaincode calculatepackageid`).
- Service Cloud Map: `chaincode.blockagri.id:9999` (sesuai `fabric/chaincode-package/connection.json`).

## 6. Deploy backend (Go)
- Register `deploy/ecs/backend.taskdef.json` (isi `<ACCOUNT>`, `<REGION>`, `<RDS_ENDPOINT>`, `<EFS_ID>`, `JWT_KEY`).
- Mount EFS materi kripto ke `/fabric/organizations` (read-only).
- ECS service di subnet privat, target group ALB (port 8080, health check `/api/health`).
- Backend otomatis migrate Postgres + seed (RegisterFarmer/Policy on-chain) saat start.

## 7. Deploy frontend
- Register `deploy/ecs/frontend.taskdef.json`, ECS service di belakang ALB publik (port 80).
- `nginx.conf` mem-proxy `/api` → service backend. Set target proxy ke DNS Cloud Map backend bila perlu.
- Alternatif lebih murah: `npm run build` lalu host `dist/` di **S3 + CloudFront**, arahkan `/api` ke ALB backend.

## 8. Verifikasi
- Buka domain frontend (CloudFront/ALB). Login `budi` / `password123`.
- Submit panen → verifikasi (akun `bulog`) → cek **Blockchain Explorer** → **Verifikasi Integritas** (rantai blok native Fabric utuh).

## Ringkas keamanan produksi
- `JWT_KEY` & password DB → **AWS Secrets Manager** (rujuk via `secrets` di task definition).
- Security group: hanya backend yang boleh menjangkau peer (7051/8051/…), hanya ALB yang menjangkau frontend/backend.
- Aktifkan TLS peer↔chaincode (saat ini CCaaS TLS disabled untuk kesederhanaan; nyalakan di produksi).
