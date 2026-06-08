#!/usr/bin/env bash
# Simulator ESP32-CAM (Smart Scale): kirim foto display timbangan ke backend.
# Skema: ESP kirim GAMBAR → server simpan ke S3 → OCR (Tesseract) → berat untuk Bulog.
#
# Pakai:
#   bash deploy/iot-simulator.sh <harvestChainId> <path-gambar> [API_URL] [IOT_KEY]
# Contoh (di EC2):
#   bash deploy/iot-simulator.sh HRV-0001 "OCR Sample/photo_6138933203448827892_x.jpg"
set -euo pipefail

HID="${1:?harvestChainId wajib, mis. HRV-0001 (lihat panen petani)}"
IMG="${2:?path gambar wajib, mis. 'OCR Sample/foto.jpg'}"
API="${3:-http://localhost:8080}"
KEY="${4:-${IOT_API_KEY:-}}"

[ -f "$IMG" ] || { echo "Gambar tidak ditemukan: $IMG"; exit 1; }

echo "==> Kirim $IMG sebagai foto timbangan untuk panen $HID → $API"
curl -sS -X POST "$API/api/iot/weight" \
  ${KEY:+-H "X-IoT-Key: $KEY"} \
  -F "harvestChainId=$HID" \
  -F "image=@${IMG};type=image/jpeg"
echo
echo "==> Selesai. Buka verifikasi Bulog → foto & berat OCR muncul di panen $HID."
