#!/usr/bin/env python3

import os
import sys
import time
import argparse
import logging
import mimetypes

import requests
import mysql.connector
from mysql.connector import pooling
from datetime import datetime, timezone


# ── Konfigurasi ──────────────────────────────────────────────────────────────

API_BASE     = os.environ.get("API_BASE",  "https://blockagrichain.digitalisasi-pi.com")
HARVESTS_URL = API_BASE + "/api/harvests"
WEIGHT_URL   = API_BASE + "/api/iot-value/weight"
LOGIN_URL    = API_BASE + "/api/auth/login"

# Kredensial login untuk generate JWT (BULOG)
AUTH_USERNAME = os.environ.get("AUTH_USERNAME", "bulog")
AUTH_PASSWORD = os.environ.get("AUTH_PASSWORD", "password123")

DEVICE_ID = os.environ.get("DEVICE_ID", "ESP32CAM-01")

# Folder gambar IoT ke-1 (OCR) — sudah diproses oleh ocr_watcher
DONE_DIR       = os.environ.get("DONE_DIR",       "./done_ocr")
# Folder gambar IoT ke-2 (hasil panen) — diisi oleh image_server /upload-hasil-panen
PANEN_DIR      = os.environ.get("PANEN_DIR",      "./gambar-hasil-panen")

POLL_INTERVAL  = float(os.environ.get("POLL_INTERVAL_S", "10"))
HTTP_TIMEOUT   = float(os.environ.get("HTTP_TIMEOUT_S",  "30"))

DB = {
    "host":     os.environ.get("DB_HOST", "127.0.0.1"),
    "port":     int(os.environ.get("DB_PORT", "3306")),
    "user":     os.environ.get("DB_USER", "agri"),
    "password": os.environ.get("DB_PASS", "BlockAgriChain"),
    "database": os.environ.get("DB_NAME", "BlockAgriChain"),
    "charset":  "utf8mb4",
}
TABLE = os.environ.get("DB_TABLE", "ocr_results")

# Baris dianggap "belum terkirim" bila sent_at IS NULL.
# Setelah POST sukses, sent_at diisi sehingga tidak dikirim lagi.
# Batas percobaan per baris (0 = tak terbatas).
MAX_ATTEMPTS = int(os.environ.get("MAX_ATTEMPTS", "5"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("sync")


# ── Manajemen JWT (auto-login + auto-refresh) ─────────────────────────────────

class TokenManager:
    """Login sekali, simpan token & expiry, refresh otomatis menjelang kedaluwarsa."""

    def __init__(self, username, password):
        self.username = username
        self.password = password
        self.token = None
        self.expires_at = None       # datetime (UTC, aware) atau None
        self.refresh_margin = 60.0   # refresh bila sisa waktu < margin ini (detik)

    def _login(self):
        log.info("Login sebagai '%s'...", self.username)
        resp = requests.post(
            LOGIN_URL,
            json={"username": self.username, "password": self.password},
            timeout=HTTP_TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json()
        self.token = data.get("token")
        if not self.token:
            raise RuntimeError(f"Login berhasil tapi tanpa token: {data}")
        self.expires_at = self._parse_expiry(data.get("expiresAt"))
        log.info("Token diperoleh (expiresAt=%s).", data.get("expiresAt"))

    @staticmethod
    def _parse_expiry(s):
        if not s:
            return None
        txt = s.replace("Z", "+00:00")
        if "." in txt:
            head, frac = txt.split(".", 1)
            tz = ""
            for sep in ("+", "-"):
                idx = frac.find(sep)
                if idx != -1:
                    tz = frac[idx:]
                    frac = frac[:idx]
                    break
            frac = frac[:6]
            txt = f"{head}.{frac}{tz}"
        try:
            dt = datetime.fromisoformat(txt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except ValueError:
            return None

    def _expired_soon(self):
        if self.token is None:
            return True
        if self.expires_at is None:
            return False
        now = datetime.now(timezone.utc)
        remaining = (self.expires_at - now).total_seconds()
        return remaining <= self.refresh_margin

    def get_token(self, force=False):
        if force or self._expired_soon():
            self._login()
        return self.token

    def auth_headers(self, force=False):
        return {"Authorization": f"Bearer {self.get_token(force=force)}"}


TOKENS = TokenManager(AUTH_USERNAME, AUTH_PASSWORD)


# ── HTTP helpers ──────────────────────────────────────────────────────────────

def fetch_harvests():
    """GET /api/harvests -> list of dict."""
    resp = requests.get(HARVESTS_URL, headers=TOKENS.auth_headers(), timeout=HTTP_TIMEOUT)
    if resp.status_code == 401:
        resp = requests.get(HARVESTS_URL, headers=TOKENS.auth_headers(force=True),
                            timeout=HTTP_TIMEOUT)
    resp.raise_for_status()
    data = resp.json()
    if isinstance(data, dict):
        for key in ("data", "harvests", "items", "results"):
            if isinstance(data.get(key), list):
                return data[key]
        return [data]
    if isinstance(data, list):
        return data
    return []


def guess_mime(path):
    mime, _ = mimetypes.guess_type(path)
    if mime and mime.startswith("image/"):
        return mime
    ext = os.path.splitext(path)[1].lower()
    return {
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
        ".bmp": "image/bmp",  ".gif": "image/gif",   ".tif": "image/tiff",
        ".tiff": "image/tiff", ".webp": "image/webp",
    }.get(ext, "application/octet-stream")


def _read_image(image_path):
    """Baca file gambar ke bytes. Raise ValueError bila kosong."""
    with open(image_path, "rb") as f:
        data = f.read()
    if not data:
        raise ValueError(f"File gambar kosong: {image_path}")
    return data


def post_weight(harvest_chain_id, ocr_weight, image_path, panen_path):
    """
    POST multipart/form-data ke /api/iot-value/weight.

    Parameter:
        harvest_chain_id : str — harvestChainId
        ocr_weight       : str — nilai berat dari OCR (IoT ke-1)
        image_path       : str — path gambar OCR dari done_ocr/ (IoT ke-1, wajib)
        panen_path       : str — path gambar hasil panen dari
                           gambar-hasil-panen/ (IoT ke-2, wajib)

    Multipart fields yang dikirim:
        harvestChainId — teks
        deviceId       — teks (DEVICE_ID)
        ocrWeight      — teks
        image          — file (IoT ke-1, gambar OCR dari done_ocr/)
        image          — file (IoT ke-2, gambar hasil panen dari gambar-hasil-panen/)
    Dua field 'image' dikirim via list of tuples (bukan dict) agar
    requests meneruskan keduanya sebagai multipart entries terpisah.

    Kedua gambar dibaca ke memori sebelum dikirim agar aman
    dipakai ulang saat retry (mis. setelah refresh token).
    Pemanggil (run_once) bertanggung jawab memastikan panen_path
    tidak None sebelum memanggil fungsi ini.
    """
    # Baca gambar OCR (IoT ke-1) — wajib
    img_bytes = _read_image(image_path)
    img_fname = os.path.basename(image_path)
    img_mime  = guess_mime(image_path)
    log.info("  [IoT-1] image      : %s (%s, %d bytes)", img_fname, img_mime, len(img_bytes))

    # Baca gambar hasil panen (IoT ke-2) — wajib ada (sudah divalidasi di run_once)
    panen_bytes = _read_image(panen_path)
    panen_fname = os.path.basename(panen_path)
    panen_mime  = guess_mime(panen_path)
    log.info("  [IoT-2] image (hasil panen): %s (%s, %d bytes)",
             panen_fname, panen_mime, len(panen_bytes))

    def build_files():
        # API menerima dua field bernama 'image':
        #   image[0] — gambar OCR (IoT ke-1)
        #   image[1] — gambar hasil panen (IoT ke-2)
        # requests tidak mendukung duplicate key pada dict,
        # gunakan list of tuples agar urutan & nama field terjaga.
        return [
            ("harvestChainId", (None, str(harvest_chain_id))),
            ("deviceId",       (None, DEVICE_ID)),
            ("ocrWeight",      (None, str(ocr_weight))),
            ("image",          (img_fname,   img_bytes,   img_mime)),
            ("image",          (panen_fname, panen_bytes, panen_mime)),
        ]

    resp = requests.post(
        WEIGHT_URL, headers=TOKENS.auth_headers(), files=build_files(),
        timeout=HTTP_TIMEOUT,
    )
    if resp.status_code == 401:
        resp = requests.post(
            WEIGHT_URL, headers=TOKENS.auth_headers(force=True), files=build_files(),
            timeout=HTTP_TIMEOUT,
        )
    return resp


# ── Database ──────────────────────────────────────────────────────────────────

def make_pool():
    return pooling.MySQLConnectionPool(pool_name="sync_pool", pool_size=2, **DB)


def fetch_ocr_for(pool, harvest_chain_id):
    """
    Ambil baris OCR PENDING untuk harvest_chain_id ini.
    Kembalikan (row_id, ocr_text, filename, filename_hasil_panen) atau None
    bila tidak ada yang layak kirim.
    """
    conn = pool.get_connection()
    try:
        cur = conn.cursor()
        attempts_clause = (
            "" if MAX_ATTEMPTS <= 0 else f"AND attempts < {MAX_ATTEMPTS} "
        )
        cur.execute(
            f"SELECT id, ocr_text, filename, filename_hasil_panen "
            f"FROM {TABLE} "
            f"WHERE harvest_chain_id = %s "
            f"AND status = 'PENDING' "
            f"AND filename IS NOT NULL AND TRIM(filename) <> '' "
            f"AND ocr_text IS NOT NULL AND TRIM(ocr_text) <> '' "
            f"{attempts_clause}"
            f"ORDER BY created_at DESC, id DESC LIMIT 1",
            (harvest_chain_id,),
        )
        row = cur.fetchone()
        cur.close()
        if not row:
            return None
        row_id, ocr_text, filename, filename_hasil_panen = row
        return row_id, str(ocr_text).strip(), filename, filename_hasil_panen
    finally:
        conn.close()


def mark_verified(pool, row_id, response_text):
    """Setelah POST sukses: ubah status PENDING -> VERIFIED, catat sent_at & response."""
    conn = pool.get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            f"UPDATE {TABLE} SET status = 'VERIFIED', sent_at = NOW(), "
            f"attempts = attempts + 1, response = %s WHERE id = %s",
            (response_text[:1000] if response_text else None, row_id),
        )
        conn.commit()
        cur.close()
    finally:
        conn.close()


def mark_failed(pool, row_id, response_text):
    """Setelah POST gagal: tambah attempts dan catat response (status tetap PENDING)."""
    conn = pool.get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            f"UPDATE {TABLE} SET attempts = attempts + 1, response = %s WHERE id = %s",
            (response_text[:1000] if response_text else None, row_id),
        )
        conn.commit()
        cur.close()
    finally:
        conn.close()


def fetch_already_sent_ocr_texts(pool):
    """
    Ambil semua ocr_text yang sudah pernah dikirim (sent_at IS NOT NULL
    atau status VERIFIED) dari DB.

    Digunakan sebagai seed awal set deduplication di run_once() agar
    ocr_text yang sudah terkirim di sesi/polling sebelumnya tidak
    dikirim ulang ke harvest_chain_id lain yang kebetulan bernilai sama.

    Kembalikan set of str.
    """
    conn = pool.get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            f"SELECT DISTINCT ocr_text FROM `{TABLE}` "
            f"WHERE (sent_at IS NOT NULL OR status = 'VERIFIED') "
            f"AND ocr_text IS NOT NULL AND TRIM(ocr_text) <> ''"
        )
        rows = cur.fetchall()
        cur.close()
        return {str(r[0]).strip() for r in rows}
    finally:
        conn.close()


def seed_harvests_to_db(pool, harvests):
    """
    [Step 1 — PERTAMA dijalankan]
    Untuk setiap harvest PENDING dari /api/harvests:
      - Jika harvest_chain_id BELUM ada di DB → INSERT baris kosong:
            harvest_chain_id = "HRV-****" (dari API)
            filename         = NULL  (menunggu ocr_watcher)
            ocr_text         = NULL  (menunggu ocr_watcher)
            status           = PENDING
        ocr_watcher akan mengisi filename + ocr_text setelah gambar tiba.

      - Jika harvest_chain_id SUDAH ada di DB → sync status saja
        (VERIFIED/REJECTED dari API → update DB).

    Harvest VERIFIED/REJECTED yang belum ada di DB → dilewati
    (tidak perlu OCR).

    Kembalikan (n_inserted, n_synced).
    """
    if not harvests:
        return 0, 0

    conn = pool.get_connection()
    n_inserted = 0
    n_synced   = 0
    n_skipped  = 0
    try:
        cur = conn.cursor()
        for h in harvests:
            hc_id  = h.get("harvestChainId")
            status = (h.get("status") or "PENDING").upper()
            if not hc_id:
                continue

            # Cek apakah sudah ada di DB
            cur.execute(
                f"SELECT id, status FROM `{TABLE}` WHERE harvest_chain_id = %s",
                (hc_id,),
            )
            row = cur.fetchone()

            if row:
                # Sudah ada → sync status bila perlu
                db_id, db_status = row
                if status in ("VERIFIED", "REJECTED") and db_status != status:
                    cur.execute(
                        f"UPDATE `{TABLE}` SET status = %s, "
                        f"sent_at = COALESCE(sent_at, NOW()) "
                        f"WHERE id = %s",
                        (status, db_id),
                    )
                    n_synced += 1
                    log.info("  [Sync]   %s: DB %s → %s", hc_id, db_status, status)
            else:
                # Belum ada di DB
                if status != "PENDING":
                    n_skipped += 1
                    log.info("  [Skip]   %s: status=%s, tidak perlu OCR.", hc_id, status)
                    continue

                # INSERT baris kosong — harvest_chain_id dulu, OCR menyusul
                cur.execute(
                    f"INSERT INTO `{TABLE}` "
                    f"(harvest_chain_id, created_at, status, attempts) "
                    f"VALUES (%s, %s, 'PENDING', 0)",
                    (hc_id, datetime.now()),
                )
                n_inserted += 1
                log.info(
                    "  [Insert] %s → DB (semua kolom NULL kecuali harvest_chain_id; "
                    "menunggu ocr_watcher isi filename + ocr_text).",
                    hc_id,
                )

        conn.commit()
        cur.close()
        if n_skipped:
            log.info("  [Info] %d harvest non-PENDING dilewati.", n_skipped)
    finally:
        conn.close()

    return n_inserted, n_synced

def sync_status_from_api(pool, harvest_chain_id, api_status):
    """
    Selaraskan status DB VPS dengan status di /api/harvests.
    Kembalikan jumlah baris yang berubah.
    """
    conn = pool.get_connection()
    try:
        cur = conn.cursor()
        if api_status == "VERIFIED":
            cur.execute(
                f"UPDATE {TABLE} SET status = 'VERIFIED', "
                f"sent_at = COALESCE(sent_at, NOW()) "
                f"WHERE harvest_chain_id = %s AND status <> 'VERIFIED'",
                (harvest_chain_id,),
            )
        elif api_status == "REJECTED":
            cur.execute(
                f"UPDATE {TABLE} SET status = 'REJECTED' "
                f"WHERE harvest_chain_id = %s AND status <> 'REJECTED'",
                (harvest_chain_id,),
            )
        else:  # PENDING
            cur.execute(
                f"UPDATE {TABLE} SET status = 'PENDING' "
                f"WHERE harvest_chain_id = %s AND status <> 'PENDING'",
                (harvest_chain_id,),
            )
        conn.commit()
        changed = cur.rowcount
        cur.close()
        return changed
    finally:
        conn.close()


# ── Util ──────────────────────────────────────────────────────────────────────

IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".bmp", ".gif", ".tif", ".tiff", ".webp")


def find_image(folder, filename):
    """
    Cari file gambar di `folder` yang cocok dengan `filename` dari DB.
    Strategi pencocokan, dari paling ketat ke longgar:
      1) path persis: folder/<filename>
      2) basename persis (buang direktori bila DB menyimpan path)
      3) nama tanpa ekstensi sama, ekstensi berbeda (mis. .png vs .jpg)
    Kembalikan path absolut bila ketemu, atau None.
    """
    if not filename:
        return None

    base = os.path.basename(filename)

    # 1) & 2) cocok persis pada basename
    cand = os.path.join(folder, base)
    if os.path.isfile(cand):
        return cand

    try:
        entries = os.listdir(folder)
    except OSError as e:
        log.error("Gagal baca folder %s: %s", folder, e)
        return None

    # 2b) cocok case-insensitive pada basename
    lower = base.lower()
    for e in entries:
        if e.lower() == lower:
            return os.path.join(folder, e)

    # 3) cocok pada nama tanpa ekstensi (ekstensi bisa beda)
    stem = os.path.splitext(base)[0].lower()
    for e in entries:
        e_stem, e_ext = os.path.splitext(e)
        if e_stem.lower() == stem and e_ext.lower() in IMAGE_EXTS:
            return os.path.join(folder, e)

    return None


# ── Proses utama ──────────────────────────────────────────────────────────────

def run_once(pool, dry_run=False):
    try:
        harvests = fetch_harvests()
    except requests.RequestException as e:
        log.error("Gagal GET harvests: %s", e)
        return

    log.info("Ditemukan %d harvest.", len(harvests))

    # ── Step 1: seed harvest_chain_id ke DB (SEBELUM OCR) ───────────────
    # INSERT baris kosong untuk setiap harvest PENDING yang belum ada di DB.
    # ocr_watcher akan mengisi filename + ocr_text setelah gambar tiba.
    n_ins, n_syn = seed_harvests_to_db(pool, harvests)
    if n_ins or n_syn:
        log.info(
            "[Seed] %d harvest_chain_id baru di-insert, %d status di-sync.",
            n_ins, n_syn,
        )

    # Set deduplication untuk satu siklus polling ini.
    # Berisi ocr_text yang sudah terkirim (dari DB) + yang baru dikirim
    # dalam iterasi siklus ini. Mencegah ocr_text yang sama dikirim lebih
    # dari sekali ke harvest_chain_id berbeda dalam satu sesi maupun antar sesi.
    seen_ocr_texts = fetch_already_sent_ocr_texts(pool)
    if seen_ocr_texts:
        log.info(
            "Dedup seed: %d ocr_text sudah pernah terkirim, "
            "tidak akan dikirim ulang.",
            len(seen_ocr_texts),
        )

    for h in harvests:
        hc_id  = h.get("harvestChainId")
        status = (h.get("status") or "").upper()

        if not hc_id:
            log.warning("Harvest tanpa harvestChainId dilewati: %r", h.get("id"))
            continue

        # ── VERIFIED ──
        if status == "VERIFIED":
            changed = sync_status_from_api(pool, hc_id, "VERIFIED")
            if changed:
                log.info("%s: VERIFIED di API -> %d baris DB diselaraskan ke VERIFIED.",
                         hc_id, changed)
            else:
                log.info("%s: VERIFIED -> lewati (DB sudah selaras, tidak kirim OCR).", hc_id)
            continue

        # ── REJECTED ──
        if status == "REJECTED":
            changed = sync_status_from_api(pool, hc_id, "REJECTED")
            if changed:
                log.info("%s: REJECTED di API -> %d baris DB diselaraskan ke REJECTED.",
                         hc_id, changed)
            else:
                log.info("%s: REJECTED -> lewati (DB sudah selaras).", hc_id)
            continue

        # ── Status tidak dikenal ──
        if status != "PENDING":
            log.info("%s: status '%s' tidak dikenal -> lewati.", hc_id, status)
            continue

        # ── PENDING: selaraskan DB ──
        changed = sync_status_from_api(pool, hc_id, "PENDING")
        if changed:
            log.info("%s: PENDING di API -> %d baris DB dikembalikan ke PENDING.",
                     hc_id, changed)

        # Ambil baris OCR dari DB (sekarang juga baca filename_hasil_panen)
        found = fetch_ocr_for(pool, hc_id)
        if not found:
            log.warning("%s: PENDING tapi tidak ada baris OCR PENDING yang layak di DB -> lewati.",
                        hc_id)
            continue

        row_id, ocr_weight, filename, filename_hasil_panen = found

        # ── Dedup: ocr_text + filename sama sudah pernah dikirim? ──
        # Kunci dedup adalah (ocr_text, filename) — bukan ocr_text saja —
        # karena dua harvest bisa saja memiliki berat yang kebetulan sama
        # tapi gambar berbeda (sah dikirim). Yang diblokir adalah pasangan
        # (ocr_text, filename) identik, yang artinya benar-benar data duplikat.
        dedup_key = (ocr_weight, filename)
        if dedup_key in seen_ocr_texts:
            log.warning(
                "%s (row %d): DIBLOKIR — pasangan (ocr_text='%s', filename='%s') "
                "sudah pernah dikirim ke API dalam sesi ini atau sesi sebelumnya. "
                "Kirim ke API hanya dilakukan sekali per pasangan unik.",
                hc_id, row_id, ocr_weight, filename,
            )
            continue

        # ── Cari gambar IoT ke-1 (OCR) di done_ocr/ ──
        image_path = find_image(DONE_DIR, filename)
        if not image_path:
            try:
                contoh = ", ".join(sorted(os.listdir(DONE_DIR))[:10])
            except OSError:
                contoh = "(folder tidak terbaca)"
            log.warning(
                "%s: gambar OCR '%s' tidak ditemukan di %s -> lewati. "
                "Isi folder (maks 10): %s",
                hc_id, filename, DONE_DIR, contoh,
            )
            continue

        # ── Cross-check: filename_hasil_panen wajib ada di DB ──
        # Kasus 1: kolom masih NULL — IoT ke-2 belum upload sama sekali.
        if not filename_hasil_panen:
            log.warning(
                "%s (row %d): DIBLOKIR — kolom filename_hasil_panen masih NULL di DB. "
                "Tunggu IoT ke-2 upload gambar hasil panen terlebih dahulu "
                "(POST /upload-hasil-panen).",
                hc_id, row_id,
            )
            continue

        # Kasus 2: nama file sudah tercatat di DB tapi file fisik tidak ada di folder.
        panen_path = find_image(PANEN_DIR, filename_hasil_panen)
        if not panen_path:
            try:
                contoh = ", ".join(sorted(os.listdir(PANEN_DIR))[:10])
            except OSError:
                contoh = "(folder tidak terbaca)"
            log.warning(
                "%s (row %d): DIBLOKIR — filename_hasil_panen='%s' tercatat di DB "
                "tapi file tidak ditemukan di %s. "
                "Isi folder (maks 10): %s",
                hc_id, row_id, filename_hasil_panen, PANEN_DIR, contoh,
            )
            continue

        # ── Dry-run ──
        if dry_run:
            log.info(
                "[dry-run] %s (row %d): akan POST "
                "ocrWeight=%s, image=%s, image_hasil_panen=%s, device=%s",
                hc_id, row_id, ocr_weight,
                os.path.basename(image_path),
                os.path.basename(panen_path),   # pasti ada, sudah divalidasi
                DEVICE_ID,
            )
            seen_ocr_texts.add(dedup_key)   # tandai agar tidak "dikirim" dua kali di dry-run
            continue

        # ── POST ke API ──
        try:
            resp = post_weight(hc_id, ocr_weight, image_path, panen_path)
            if resp.ok:
                mark_verified(pool, row_id, resp.text)
                # Catat ke seen agar sisa harvest dalam siklus ini
                # dengan pasangan (ocr_text, filename) yang sama tidak dikirim ulang.
                seen_ocr_texts.add(dedup_key)
                log.info(
                    "%s (row %d): terkirim (weight=%s, img=%s, panen=%s) "
                    "-> HTTP %d, status DB -> VERIFIED",
                    hc_id, row_id, ocr_weight,
                    os.path.basename(image_path),
                    os.path.basename(panen_path),   # pasti ada
                    resp.status_code,
                )
            else:
                mark_failed(pool, row_id, resp.text)
                log.error("%s (row %d): gagal kirim -> HTTP %d: %s",
                          hc_id, row_id, resp.status_code, resp.text[:300])
        except requests.RequestException as e:
            mark_failed(pool, row_id, str(e))
            log.error("%s (row %d): error koneksi saat POST: %s", hc_id, row_id, e)


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Sync OCR ke iot-value/weight.")
    parser.add_argument("--loop",     action="store_true", help="jalankan realtime (polling)")
    parser.add_argument("--dry-run",  action="store_true", help="tidak mengirim, hanya tampilkan")
    parser.add_argument("--interval", type=float, default=None, help="interval polling detik")
    args = parser.parse_args()

    interval = args.interval if args.interval is not None else POLL_INTERVAL

    try:
        pool = make_pool()
    except mysql.connector.Error as e:
        log.error("Gagal koneksi DB: %s", e)
        sys.exit(1)

    if not args.loop:
        run_once(pool, dry_run=args.dry_run)
        return

    log.info("Mode realtime. Polling tiap %.1fs. Ctrl+C untuk berhenti.", interval)
    try:
        while True:
            run_once(pool, dry_run=args.dry_run)
            time.sleep(interval)
    except KeyboardInterrupt:
        log.info("Berhenti.")


if __name__ == "__main__":
    main()
