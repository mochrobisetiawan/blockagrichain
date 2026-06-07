# QUICKSTART EC2 — Privat + ALB + Session Manager (langkah detail)

Arsitektur (sesuai kebutuhan: tanpa IP publik, tanpa SSH publik, web via Load Balancer):

```
Internet → ALB (subnet publik, port 80) → EC2 (subnet privat, port 8081, TANPA IP publik)
EC2 keluar internet via NAT Gateway   |   Akses shell EC2 via AWS Session Manager (browser)
```

Region: **Jakarta (ap-southeast-3)**. OS: **Ubuntu 26.04**. Tujuan tahap ini: **frontend tampil** lewat ALB.

> ⚠️ Biaya tambahan dibanding mode sederhana: **NAT Gateway** (± $0.045/jam) + **ALB** (± $0.025/jam).
> Untuk hemat saat tidak dipakai: hapus NAT Gateway & ALB (atau Stop instance).

---

## Langkah 1 — Fine-grained Personal Access Token (GitHub)
Lebih aman dari classic (dibatasi ke 1 repo, read-only).
1. Buka **https://github.com/settings/personal-access-tokens/new**
2. **Token name**: `ec2-deploy` · **Expiration**: 30 days
3. **Resource owner**: `mochrobisetiawan`
4. **Repository access** → **Only select repositories** → pilih **`blockagrichain`**
5. **Permissions** → **Repository permissions** → **Contents** → **Read-only**
   (cukup untuk `git clone`; izin lain biarkan "No access")
6. **Generate token** → **SALIN** token `github_pat_...` ke Notepad (tampil sekali)

---

## Langkah 2 — Jaringan: subnet privat + NAT Gateway
(Pakai VPC default region Jakarta.)

**2a. Buat subnet privat**
- Console → **VPC** → **Subnets** → **Create subnet**
- VPC: **default** (172.31.0.0/16)
- Subnet name: `blockagri-private-3a`
- Availability Zone: **ap-southeast-3a**
- IPv4 CIDR: `172.31.96.0/20`  (tidak bentrok dengan subnet default)
- **Create subnet**

**2b. Buat NAT Gateway** (memberi internet keluar ke subnet privat)
- VPC → **NAT gateways** → **Create NAT gateway**
- Name: `blockagri-nat`
- Subnet: pilih salah satu **subnet PUBLIK default** (mis. yang di `ap-southeast-3a`, CIDR 172.31.0.0/20)
- Connectivity type: **Public** → **Allocate Elastic IP**
- **Create NAT gateway** (tunggu status **Available**, ± 2 menit)

**2c. Route table untuk subnet privat**
- VPC → **Route tables** → **Create route table**
- Name: `blockagri-private-rt` · VPC: default → **Create**
- Tab **Routes** → **Edit routes** → **Add route**:
  - Destination `0.0.0.0/0` → Target **NAT Gateway** → `blockagri-nat` → **Save**
- Tab **Subnet associations** → **Edit subnet associations** → centang **`blockagri-private-3a`** → **Save**

---

## Langkah 3 — IAM Role untuk EC2 (akses Session Manager)
- Console → **IAM** → **Roles** → **Create role**
- Trusted entity: **AWS service** → **EC2** → Next
- Permissions: cari & centang **`AmazonSSMManagedInstanceCore`** → Next
- Role name: `blockagri-ec2-ssm` → **Create role**

---

## Langkah 4 — Launch EC2 (privat, tanpa IP publik)
- Console → **EC2** (pastikan region **Jakarta**) → **Launch instance**
- **Name**: `blockagrichain`
- **OS**: **Ubuntu** → **Ubuntu Server 26.04 LTS** (64-bit x86)
- **Instance type**: **t3.large**
- **Key pair**: **Proceed without a key pair** (kita pakai Session Manager, bukan SSH)
- **Network settings → Edit**:
  - VPC: **default**
  - Subnet: **`blockagri-private-3a`**
  - **Auto-assign public IP**: **Disable**
  - Firewall → **Create security group**, nama `blockagri-ec2-sg`
    - **Hapus** rule SSH bawaan (jangan ada inbound publik).
    - (Inbound 8081 ditambahkan nanti dari SG ALB — Langkah 7.)
- **Advanced details** → **IAM instance profile**: **`blockagri-ec2-ssm`**
- **Configure storage**: **30** GiB **gp3**
- **Launch instance** → tunggu **Running** + **2/2 checks**

---

## Langkah 5 — Masuk EC2 via Session Manager (browser, tanpa SSH)
- EC2 → **Instances** → pilih `blockagrichain` → tombol **Connect**
- Tab **Session Manager** → **Connect**
  - Jika tab ini *abu-abu/disabled*: tunggu 3–5 menit (agent SSM mendaftar via NAT), lalu refresh.
- Terbuka shell di browser (user `ssm-user`). Pindah ke user ubuntu:
  ```bash
  sudo su - ubuntu
  ```

---

## Langkah 6 — Pasang Docker + Git, clone, jalankan frontend
```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker
sudo apt-get update -y && sudo apt-get install -y git
docker --version && git --version
```
Clone (repo private):
```bash
git clone https://github.com/mochrobisetiawan/blockagrichain.git
```
- Username: `mochrobisetiawan`
- Password: **tempel fine-grained token** `github_pat_...`

Build & run frontend:
```bash
cd blockagrichain/frontend
docker build -t blockagri-frontend .
docker run -d --name frontend --restart unless-stopped -p 8081:80 blockagri-frontend
docker ps
```

---

## Langkah 7 — Application Load Balancer (expose web)
**7a. Target group**
- EC2 → **Target groups** → **Create target group**
- Target type: **Instances** · Name: `blockagri-tg`
- Protocol **HTTP** Port **8081** · VPC: default
- Health checks → Path: `/` → **Next**
- **Register targets**: centang instance `blockagrichain`, Port **8081** → **Include as pending** → **Create target group**

**7b. Load balancer**
- EC2 → **Load Balancers** → **Create load balancer** → **Application Load Balancer**
- Name: `blockagri-alb` · Scheme: **Internet-facing** · IP: IPv4
- Network: VPC default → **pilih ≥2 subnet PUBLIK** (AZ berbeda, mis. 3a & 3b)
- Security group: **Create new** `blockagri-alb-sg` → inbound **HTTP 80** dari **0.0.0.0/0**
- Listeners: **HTTP : 80** → Default action **Forward to** `blockagri-tg`
- **Create load balancer**

**7c. Izinkan ALB → EC2 (port 8081)**
- EC2 → **Security Groups** → pilih **`blockagri-ec2-sg`** → **Edit inbound rules** → **Add rule**:
  - Type **Custom TCP**, Port **8081**, Source **Custom** → pilih **`blockagri-alb-sg`** → **Save**

---

## Langkah 8 — Buka web
- EC2 → **Load Balancers** → `blockagri-alb` → **SALIN** **DNS name**
- Tunggu Target group → target **healthy** (± 1–2 menit), lalu buka:
  ```
  http://blockagri-alb-xxxxxx.ap-southeast-3.elb.amazonaws.com
  ```
🎉 **Landing + Login tampil** (lewat Load Balancer, tanpa IP publik di EC2).

> Login belum berfungsi (butuh backend + RDS) — fase berikutnya.

---

## Troubleshooting
| Gejala | Solusi |
|---|---|
| Tab **Session Manager** disabled | IAM role `AmazonSSMManagedInstanceCore` belum terpasang, atau NAT belum jalan (agent tak bisa daftar). Tunggu, refresh. |
| `get.docker.com`/`apt`/`git` gagal (timeout) | NAT Gateway/route table salah → subnet privat tak punya internet. Cek Langkah 2b/2c. |
| Target group **unhealthy** | Container frontend belum jalan (`docker ps`), atau SG EC2 belum izinkan 8081 dari SG ALB (Langkah 7c), atau health path bukan `/`. |
| ALB 502/503 | Target unhealthy (lihat atas) atau port target ≠ 8081. |

## Fase berikut (setelah web tampil)
1. **RDS SQL Server** di subnet privat (SG RDS izinkan 1433 dari `blockagri-ec2-sg`).
2. **S3** + **Secrets Manager** (`DATABASE_URL`→RDS, `JWT_KEY`, `S3_BUCKET`).
3. Tambah izin **S3 + SecretsManager** ke role `blockagri-ec2-ssm` (inline policy).
4. Jalankan penuh (Fabric + backend), lalu tambah listener/target ALB ke **port 8080** (API) bila perlu:
   ```bash
   cd ~/blockagrichain
   export AWS_REGION=ap-southeast-3 AWS_SECRET_ID=blockagri/app S3_BUCKET=blockagri-uploads-xxx
   COMPOSE_FILE=docker-compose.app-rds.yml bash deploy/up-ec2.sh
   ```
   Detail di **`README-EC2.md`**.
