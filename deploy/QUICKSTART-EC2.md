# QUICKSTART EC2 — Tampilkan Web Dulu (langkah detail)

Tujuan: men-deploy **frontend BlockAgriChain** ke **1 EC2** supaya tampilannya (Landing + Login)
bisa dilihat di browser. Backend, RDS (SQL Server), dan S3 menyusul setelah ini.

> Estimasi waktu: 15–20 menit. Biaya: t3.large ± $0.09/jam (matikan saat tak dipakai).

---

## Langkah 0 — Yang perlu disiapkan
- Akun AWS (sudah login ke Console).
- Akun GitHub `mochrobisetiawan` (repo `blockagrichain` — private).
- Komputer Windows dengan **PowerShell** (sudah ada OpenSSH bawaan Windows 10/11).

---

## Langkah 1 — Buat Personal Access Token (PAT) GitHub
Repo private, jadi butuh token untuk `git clone`.
1. Buka https://github.com/settings/tokens
2. **Generate new token** → **Generate new token (classic)**.
3. **Note**: `ec2-deploy`. **Expiration**: 30 days.
4. Centang scope **`repo`** (seluruh kotak repo).
5. **Generate token** → **SALIN** token-nya (mulai `ghp_...`). Simpan sementara di Notepad.
   (Token hanya tampil sekali.)

---

## Langkah 2 — Launch EC2 (AWS Console)
1. Login Console → kolom pencarian atas ketik **EC2** → Enter.
2. Pastikan **Region** (pojok kanan atas) = **Asia Pacific (Singapore) ap-southeast-1**.
3. Klik tombol oranye **Launch instance**.
4. **Name and tags** → Name: `blockagrichain`.
5. **Application and OS Images** → klik **Ubuntu** → pilih **Ubuntu Server 24.04 LTS** (atau 26.04). Arsitektur **64-bit (x86)**.
6. **Instance type** → pilih **t3.large**.
7. **Key pair (login)** → **Create new key pair**:
   - Name: `blockagri-key`
   - Type: **RSA**, Format: **.pem**
   - **Create key pair** → file `blockagri-key.pem` ter-download ke folder **Downloads**.
8. **Network settings** → klik **Edit**:
   - **Auto-assign public IP**: **Enable**.
   - **Firewall (security groups)** → **Create security group**, centang:
     - ✅ Allow SSH traffic from → **My IP**
   - Klik **Add security group rule**:
     - Type: **Custom TCP**, Port range: **8081**, Source type: **Anywhere (0.0.0.0/0)**
   - (Opsional, untuk nanti) tambah rule lagi: Port **8080**, Source **Anywhere**.
9. **Configure storage** → ubah jadi **30** GiB, tipe **gp3**.
10. Panel kanan **Summary** → **Launch instance**.
11. Klik **View all instances** → tunggu **Instance state = Running** dan **Status check = 2/2 checks passed** (± 2 menit).
12. Klik instance `blockagrichain` → **SALIN** **Public IPv4 address** (mis. `13.250.x.x`).

---

## Langkah 3 — Connect SSH dari Windows (PowerShell)
1. Buka **PowerShell** (Start → ketik PowerShell).
2. Masuk ke folder Downloads:
   ```powershell
   cd $env:USERPROFILE\Downloads
   ```
3. Kunci private harus tidak boleh "terlalu terbuka". Perbaiki izin file:
   ```powershell
   icacls blockagri-key.pem /inheritance:r
   icacls blockagri-key.pem /grant:r "$($env:USERNAME):(R)"
   ```
4. SSH ke server (ganti IP):
   ```powershell
   ssh -i blockagri-key.pem ubuntu@<PUBLIC_IP>
   ```
5. Muncul pertanyaan `Are you sure you want to continue connecting (yes/no)?` → ketik **yes** → Enter.
6. Berhasil bila prompt berubah jadi:
   ```
   ubuntu@ip-172-31-xx-xx:~$
   ```

> Kalau "Connection timed out": cek Security Group port 22 = My IP, dan IP publik benar.

---

## Langkah 4 — Pasang Docker + Git (jalankan DI server)
Salin-tempel satu per satu:
```bash
curl -fsSL https://get.docker.com | sudo sh
```
```bash
sudo usermod -aG docker $USER && newgrp docker
```
```bash
sudo apt-get update -y && sudo apt-get install -y git
```
Cek berhasil:
```bash
docker --version
git --version
```

---

## Langkah 5 — Ambil kode dari GitHub
```bash
git clone https://github.com/mochrobisetiawan/blockagrichain.git
```
- Saat diminta **Username**: ketik `mochrobisetiawan`
- Saat diminta **Password**: **tempel PAT** (`ghp_...`) dari Langkah 1 (tidak terlihat saat diketik — normal) → Enter.

Masuk ke folder:
```bash
cd blockagrichain
```

---

## Langkah 6 — Build & jalankan FRONTEND
```bash
cd frontend
docker build -t blockagri-frontend .
```
(± 2–4 menit; mengunduh Node + build React.)
```bash
docker run -d --name frontend --restart unless-stopped -p 8081:80 blockagri-frontend
```
Cek container hidup:
```bash
docker ps
```
Harus ada baris `blockagri-frontend ... 0.0.0.0:8081->80/tcp`.

---

## Langkah 7 — Buka di browser
```
http://<PUBLIC_IP>:8081
```
🎉 **Landing page + Login muncul.**

> **Login belum berfungsi** (butuh backend + RDS) — ini wajar. Tahap ini hanya menampilkan web.

---

## Operasional
- Lihat log frontend: `docker logs -f frontend`
- Restart: `docker restart frontend`
- **Hemat biaya**: matikan instance saat tak dipakai →
  Console EC2 → pilih instance → **Instance state → Stop instance**.
  (IP publik berubah saat di-Start lagi; data tetap.)

## Troubleshooting
| Gejala | Solusi |
|---|---|
| Browser tak terbuka / timeout | Security Group port **8081** belum **0.0.0.0/0**. Tambah inbound rule. |
| `git clone` gagal auth | PAT salah/expired, atau scope `repo` tak dicentang. Buat ulang PAT. |
| `docker: permission denied` | Jalankan `newgrp docker` lagi, atau logout-login SSH. |
| Build lambat/OOM | t3.large cukup; bila perlu tambah swap 4 GB: `sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile` |

---

## Fase berikut (setelah web tampil)
1. **RDS SQL Server** → catat endpoint (Security Group RDS izinkan 1433 dari SG EC2).
2. **S3 bucket** + **AWS Secrets Manager** (isi `DATABASE_URL` ke RDS, `JWT_KEY`, `S3_BUCKET`).
3. **IAM role** ke EC2 (akses S3 + Secret) — *Actions → Security → Modify IAM role*.
4. Jalankan penuh (Fabric + backend, mode RDS):
   ```bash
   cd ~/blockagrichain
   export AWS_REGION=ap-southeast-1 AWS_SECRET_ID=blockagri/app S3_BUCKET=blockagri-uploads-xxx
   COMPOSE_FILE=docker-compose.app-rds.yml bash deploy/up-ec2.sh
   ```
   Detail di **`README-EC2.md`**.
