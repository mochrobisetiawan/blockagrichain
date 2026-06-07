#!/usr/bin/env bash
#
# up-ec2.sh — jalankan SELURUH BlockAgriChain di satu instance EC2 (Ubuntu + Docker).
# Menaikkan: jaringan Fabric (5 peer + orderer) + chaincode + SQL Server + backend Go + frontend.
#
#   bash deploy/up-ec2.sh         # dijalankan dari root Project/
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> 1/4 Cek Docker"
command -v docker >/dev/null || { echo "Docker belum terpasang. Pasang dulu (lihat README-EC2.md)."; exit 1; }

echo "==> 2/4 Cek binari Fabric"
if ! command -v peer >/dev/null || [ ! -d "$ROOT/fabric/bin" ]; then
  echo "    Mengunduh binari + image Fabric 2.5…"
  ( cd "$ROOT/fabric" && curl -sSL https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh | bash -s -- binary docker )
fi
export PATH="$ROOT/fabric/bin:$PATH"
export FABRIC_CFG_PATH="$ROOT/fabric/config"

echo "==> 3/4 Menaikkan jaringan Fabric + chaincode"
( cd "$ROOT/fabric" && ./network.sh up )

echo "==> 4/4 Menaikkan aplikasi (backend Go + frontend [+ SQL Server jika lokal])"
# Pakai RDS? jalankan: COMPOSE_FILE=docker-compose.app-rds.yml bash deploy/up-ec2.sh
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.app.yml}"
echo "    compose: $COMPOSE_FILE"
# Muat rahasia dari deploy/db.env bila ada (DATABASE_URL/JWT_KEY/S3_BUCKET) — cara
# andal tanpa mengandalkan export shell yang gampang hilang saat lewat sudo/skrip.
( cd "$ROOT/deploy"
  ENVFILE=""
  if [ -f db.env ]; then ENVFILE="--env-file db.env"; echo "    memuat env: deploy/db.env"; fi
  docker compose $ENVFILE -f "$COMPOSE_FILE" up -d --build )

echo ""
echo "✅ BlockAgriChain berjalan di EC2 ini."
echo "   Frontend : http://<IP_PUBLIK_EC2>:8081"
echo "   API      : http://<IP_PUBLIK_EC2>:8080/api/health"
echo "   Login    : budi / password123 (atau bulog/kementan/kemenkeu/pihc)"
echo ""
echo "   Buka port 8081 (dan 8080 bila perlu) di Security Group EC2."
