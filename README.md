# BlockAgriChain — Blockchain Alokasi Pupuk Subsidi (Hyperledger Fabric)

Sistem **transparansi penyaluran pupuk bersubsidi** berbasis **Hyperledger Fabric 2.5** (permissioned blockchain) dengan **Go Chaincode**, backend **Go**, frontend **React + Vite**, dan integrasi **IoT (ESP32-CAM) + OCR**.
Proyek Akhir — Mata Kuliah **Teknologi Blockchain (KOM1635)**, IPB University — **Kelompok 4**.

Alur hulu→hilir: **Petani** lapor panen → **Bulog** verifikasi fisik (IoT/OCR) → *smart contract* menghitung alokasi otomatis → **PIHC** distribusi → **Petani** konfirmasi terima → **PIHC** klaim → **Kemenkeu** cairkan subsidi, dengan **Kementan** pembuat kebijakan. Semua transaksi **immutable & dapat diaudit**.

---

## 1. Arsitektur Singkat

| Lapisan | Teknologi | Lokasi |
|---|---|---|
| Frontend | React 19 + Vite + TypeScript | `frontend/` |
| Backend / API Gateway | **Go** (chi) + JWT + **Fabric Gateway SDK (gRPC)** + GORM (SQL Server) | `backend-go/` |
| Smart Contract | **Go Chaincode** (Fabric, CCaaS) | `chaincode/` |
| Jaringan Blockchain | **Hyperledger Fabric 2.5** — 5 org MSP + Orderer (Raft), World State **CouchDB** | `fabric/` |
| Penyimpanan off-chain | **SQL Server** (PII/biodata) + **Amazon S3** (foto, presigned) | `backend-go/internal/storage` |
| Deploy | Docker Compose per service (EC2/AWS) | `deploy/` |

**5 MSP (1:1 dengan peran):** `PetaniMSP · BulogMSP · KementanMSP · KemenkeuMSP · PIHCMSP` + `OrdererMSP`.
Kontrol akses (ABAC/RBAC) ditegakkan di chaincode berdasarkan **MSP sertifikat pengirim** transaksi.

**On-chain vs Off-chain:** ledger menyimpan hash dokumen, ID, status, kuota, audit. Data pribadi (NIK, biodata, GPS) & file foto disimpan off-chain (SQL Server + S3); **NIK tidak pernah masuk ledger** — hanya `SHA-256(NIK)`.

---

## 2. Prasyarat (Prerequisites)

Jalankan di **Linux / WSL2 / EC2 Ubuntu** (Fabric butuh Docker Linux).

| Alat | Versi minimal | Cek |
|---|---|---|
| Docker Engine | 24+ | `docker --version` |
| Docker Compose plugin | v2 | `docker compose version` |
| Go | 1.22+ | `go version` |
| Node.js + npm | 18+ | `node -v` |
| Git, curl, jq | terbaru | `git --version` |
| Binari & image Hyperledger Fabric | 2.5.x | `peer version` |

> Windows: gunakan **WSL2 (Ubuntu)**. Pastikan Docker Desktop integrasi WSL2 aktif.

---

## 3. Instalasi Lengkap (Lokal)

### Langkah 0 — Clone repository
```bash
git clone https://github.com/mochrobisetiawan/blockagrichain.git
cd blockagrichain
```

### Langkah 1 — Pasang binari + image Fabric (sekali saja)
```bash
curl -sSL https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh | bash -s -- binary docker
export PATH=$PWD/fabric/bin:$PATH
export FABRIC_CFG_PATH=$PWD/fabric/config
peer version   # verifikasi
```

### Langkah 2 — Siapkan environment backend
Salin contoh env lalu sesuaikan:
```bash
cp backend-go/.env.example backend-go/.env
```
Isi minimal `backend-go/.env`:
```env
DATABASE_URL=sqlserver://sa:Your_Strong_Pass1@mssql:1433?database=BlockAgriChain
JWT_KEY=ganti-dengan-kunci-acak-panjang
S3_BUCKET=                # kosongkan untuk mode lokal tanpa S3
AWS_SECRET_ID=
# IOT_API_KEY=opsional-kunci-perangkat-esp32
```
> **JANGAN commit** file `.env` / private key (sudah di-`.gitignore`).

### Langkah 3 — Naikkan jaringan Fabric + chaincode
Membuat crypto (cryptogen), channel, lalu install/approve/commit chaincode:
```bash
cd fabric
./network.sh up
cd ..
```

### Langkah 4 — Naikkan database, backend, dan frontend
```bash
cd deploy
docker compose -f docker-compose.app.yml up -d --build
cd ..
```
- Frontend: **http://localhost:8081**
- API: **http://localhost:8080**  (cek: `curl http://localhost:8080/api/health`)

### (Opsional) Mode dev frontend (hot reload)
```bash
cd frontend
npm install
npm run dev     # proxy /api -> :8080
```

---

## 4. Akun Demo (password: `password123`)

| Username | Peran | MSP |
|---|---|---|
| `budi` | Petani | PetaniMSP |
| `bulog` | Bulog (validator) | BulogMSP |
| `kementan` | Kementerian Pertanian | KementanMSP |
| `kemenkeu` | Kementerian Keuangan | KemenkeuMSP |
| `pihc` | Pupuk Indonesia | PIHCMSP |

> Petani juga dapat **mendaftar mandiri** dari halaman Login (tab "Daftar") → disetujui Kementan.

---

## 5. Alur Demo End-to-End
1. **budi** → Input Panen (foto di-hash SHA-256 di klien; hanya hash + GPS ke ledger).
2. **bulog** → Antrian Verifikasi → data IoT/OCR (ESP32-CAM) → **Setuju**/**Tolak (wajib alasan)** → alokasi dihitung otomatis chaincode.
3. **pihc** → Distribusi → Buat Order → Kirim → Tandai Terkirim.
4. **budi** → **Konfirmasi Terima** (hanya petani penerima — ditegakkan chaincode MSP + ownership).
5. **pihc** → Ajukan Klaim subsidi.
6. **kemenkeu** → **Cairkan** (SP2D).
7. Siapa pun (sesuai peran) → **Blockchain Explorer** → **Verifikasi Integritas** rantai blok.

### Read vs Write (Fabric)
- **Read** (bebas gas): `Evaluate`/query — Explorer, GetActivePolicy, riwayat on-chain (tidak membentuk blok).
- **Write** (transaksi): `Submit` — Endorsement MSP → Order (Raft) → Validate & Commit; bukti **TxID + nomor blok** ditampilkan di UI.

---

## 6. Integrasi IoT (ESP32-CAM + OCR)
- ESP32-CAM mengirim **gambar display timbangan** ke `POST /api/iot/weight` (multipart) atau berat langsung ke `POST /api/iot-value/weight`.
- Otorisasi: **Bearer JWT** atau header **`X-IoT-Key`**.
- Server menyimpan foto ke S3 (privat) lalu menjalankan **OCR (Tesseract)** → berat muncul di layar verifikasi Bulog.
- Koleksi uji: `deploy/BlockAgriChain.postman_collection.json` (import ke Postman).

---

## 7. Fungsi Chaincode (`chaincode/`)
`RegisterFarmer`, `SubmitHarvest`, `SubmitVerification` (→ otomatis `CalculateAllocation`),
`ProposePolicy` / `ApprovePolicy`, `CreateDistribution` / `UpdateDistributionStatus`,
`RequestPayment` / `ApprovePayment` / `RejectPayment`, `DisableFarmer`,
serta query: `GetFarmer`, `GetHarvestById`, `GetActivePolicy`, `GetState`, **`GetTransactionHistory`** (audit trail).

**Access Control (contoh endorsement):** `SubmitHarvest` → PetaniMSP; `SubmitVerification` → BulogMSP; `ApprovePolicy` → KemenkeuMSP+KementanMSP (2-of-2); `ApprovePayment` → KemenkeuMSP+PIHCMSP (2-of-2).

---

## 8. Deploy ke AWS (ringkas)
- **EC2 (disarankan):** instance di private subnet (tanpa IP publik, diakses via Session Manager), di belakang **ALB**; database **RDS (SQL Server)**; foto di **S3**.
  ```bash
  sudo -i && cd /home/ssm-user/blockagrichain
  git pull
  docker compose -f deploy/docker-compose.app-rds.yml --env-file deploy/db.env up -d --build
  ```
- Detail: **[deploy/README-EC2.md](deploy/README-EC2.md)**.

---

## 9. Deployment IoT
1. **clean_database_realtime.py** → Digunakan sebagai pembersihan DB ketika terjadi kesalah input berdasarkan OCR.
2. **sync_ocr1.py** → Digunakan sebagai proses sync dari server web dengan IoT secara online.
3. **ocr_watcher8.py** → Digunakan sebagai proses OCR dengan melakukan capture pada gambar digital timbangan.
4. **image_server.py** → Digunakan sebagai penerimaan file pada device ESPCAM3201 & ESPCAM3202
5. **ESP32CAM01.ino** → Digunakan untuk membangun IoT devices ESP32CAM01 sebagai pengiriman file gambar digital timbangan ke server
6. **ESP32CAM02.ino** → Digunakan untuk membangun IoT devices ESP32CAM01 sebagai pengiriman file gambar hasil panen ke server

## 10. Struktur Proyek
```
blockagrichain/
├─ frontend/      # React + Vite (UI 5 peran)
├─ backend-go/    # API Gateway Go (chi, JWT, Fabric Gateway, GORM)
├─ chaincode/     # Go Chaincode (smart contract Fabric)
├─ fabric/        # Jaringan Fabric (network.sh, configtx, crypto config)
├─ deploy/        # Docker Compose, skrip deploy, koleksi Postman
├─ docs/          # SKPL, DPPL, diagram, manajemen proyek
└─ OCR Sample/    # Contoh gambar untuk uji OCR IoT
└─ IoT/           # Digunakan sebagai proses sync IoT dengan website (OCR dan Hasil Panen)
```

---

## 11. Troubleshooting
| Masalah | Solusi |
|---|---|
| `peer: command not found` | jalankan `export PATH=$PWD/fabric/bin:$PATH` |
| `permission denied` saat `network.sh` | `chmod +x fabric/network.sh` lalu `chmod -R a+rX fabric/organizations` |
| Backend gagal konek DB | cek `DATABASE_URL` di `backend-go/.env` & kontainer DB sudah `Up` |
| `x509 / ECDSA verification failure` | bersihkan: `cd fabric && ./network.sh down`, lalu `./network.sh up` ulang |
| Frontend tak terhubung API | pastikan API `:8080` jalan (`curl /api/health`) |

---

## Tim Pengembang (Kelompok 4)
- **Muhamad Iqbal Aprido** — M0503251001
- **Galuh Muhammad Iman Akbar** — M0503251031
- **Moch Robi Setiawan** — M0503251041

---
