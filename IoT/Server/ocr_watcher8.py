#!/usr/bin/env python3

import os
import re
import time
import shutil
import logging
from datetime import datetime

import numpy as np
from PIL import Image, ImageOps, ImageFilter
import easyocr
import mysql.connector
from mysql.connector import pooling


# ── Konfigurasi ───────────────────────────────────────────────────────────────

def env(k, d):    return os.environ.get(k, d)
def env_f(k, d):
    try:    return float(os.environ.get(k, d))
    except: return d
def env_b(k, d):
    v = os.environ.get(k)
    if v is None: return d
    return v in ("1", "true", "True", "TRUE")

CFG = {
    "INPUT_DIR":  env("INPUT_DIR",  "./ready_ocr"),
    "DONE_DIR":   env("DONE_DIR",   "./done_ocr"),
    "FAIL_DIR":   env("FAIL_DIR",   "./failed_ocr"),
    "OUTPUT_DIR": env("OUTPUT_DIR", "./ocr_results"),
    "PREPRO_DIR": env("PREPRO_DIR", "./preprocessed"),

    "POLL_INTERVAL": env_f("POLL_INTERVAL_S", 2.0),
    "STABLE_WAIT":   env_f("STABLE_WAIT_S",   1.0),

    # Preprocessing
    "UPSCALE_FACTOR": env_f("UPSCALE_FACTOR", 2.0),
    "GRAYSCALE":      env_b("GRAYSCALE",  True),
    "THRESHOLD":      env_b("THRESHOLD",  True),
    "INVERT":         env_b("INVERT",     False),
    "SAVE_PREPRO":    env_b("SAVE_PREPRO", True),

    # EasyOCR
    "OCR_LANG":      env("OCR_LANG",  "en"),
    "USE_GPU":       env_b("USE_GPU", False),
    "ALLOWLIST":     env("ALLOWLIST", ""),
    "OCR_MAX_RETRY": int(env("OCR_MAX_RETRY", "3")),
    "ALLOW_DECIMAL": env_b("ALLOW_DECIMAL", False),

    # Database
    "DB_HOST": env("DB_HOST", "127.0.0.1"),
    "DB_PORT": int(env("DB_PORT", "3306")),
    "DB_USER": env("DB_USER", "agri"),
    "DB_PASS": env("DB_PASS", "BlockAgriChain"),
    "DB_NAME": env("DB_NAME", "BlockAgriChain"),
}

TABLE      = env("DB_TABLE", "ocr_results")
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".gif"}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("ocr")


# ── Validasi OCR ──────────────────────────────────────────────────────────────

def is_valid_number(text):
    """
    True bila text angka murni non-kosong.
    Retry dipicu bila kosong, ada whitespace, atau ada karakter non-digit.
    """
    if not text or text.strip() == "":         return False
    if any(ch.isspace() for ch in text):       return False
    if CFG["ALLOW_DECIMAL"]:
        return re.fullmatch(r"\d+(\.\d+)?", text) is not None
    return re.fullmatch(r"\d+", text) is not None


# ── Database ──────────────────────────────────────────────────────────────────

def make_pool():
    return pooling.MySQLConnectionPool(
        pool_name="agri_ocr_pool", pool_size=3,
        host=CFG["DB_HOST"], port=CFG["DB_PORT"],
        user=CFG["DB_USER"], password=CFG["DB_PASS"],
        database=CFG["DB_NAME"], charset="utf8mb4",
    )


def init_schema(pool):
    """Buat tabel bila belum ada + pastikan kolom nullable."""
    conn = pool.get_connection()
    try:
        cur = conn.cursor()
        cur.execute(f"""
            CREATE TABLE IF NOT EXISTS `{TABLE}` (
                id                   INT AUTO_INCREMENT PRIMARY KEY,
                filename             VARCHAR(255) NULL DEFAULT NULL
                    COMMENT 'Diisi ocr_watcher setelah OCR',
                filename_hasil_panen VARCHAR(255) NULL DEFAULT NULL
                    COMMENT 'Diisi image_server dari IoT ke-2',
                ocr_text             TEXT NULL
                    COMMENT 'Diisi ocr_watcher setelah OCR',
                created_at           DATETIME NOT NULL,
                harvest_chain_id     VARCHAR(64) NULL DEFAULT NULL
                    COMMENT 'Diisi sync_ocr dari /api/harvests (DULU)',
                status               ENUM('PENDING','VERIFIED','REJECTED')
                                     NOT NULL DEFAULT 'PENDING',
                attempts             INT NOT NULL DEFAULT 0,
                sent_at              DATETIME NULL,
                response             TEXT NULL,
                INDEX  idx_filename       (filename),
                INDEX  idx_status         (status),
                INDEX  idx_hcid_status    (harvest_chain_id, status),
                INDEX  idx_filename_panen (filename_hasil_panen(191)),
                UNIQUE KEY uq_harvest_chain_id (harvest_chain_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        """)

        # Upgrade: tambah filename_hasil_panen bila belum ada
        cur.execute("""
            SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME   = %s
              AND COLUMN_NAME  = 'filename_hasil_panen'
        """, (TABLE,))
        if cur.fetchone()[0] == 0:
            cur.execute(f"""
                ALTER TABLE `{TABLE}`
                ADD COLUMN filename_hasil_panen VARCHAR(255) NULL DEFAULT NULL
                    COMMENT 'Diisi image_server dari IoT ke-2'
                AFTER filename
            """)
            log.info("Kolom filename_hasil_panen ditambahkan.")

        # Upgrade: pastikan filename nullable
        cur.execute("""
            SELECT IS_NULLABLE FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME   = %s AND COLUMN_NAME = 'filename'
        """, (TABLE,))
        row = cur.fetchone()
        if row and row[0] == "NO":
            cur.execute(f"ALTER TABLE `{TABLE}` MODIFY COLUMN filename VARCHAR(255) NULL DEFAULT NULL")
            log.info("Kolom filename diubah menjadi nullable.")

        conn.commit()
        cur.close()
    finally:
        conn.close()


def claim_pending_slot(pool):
    """
    Cari baris PENDING yang:
      - harvest_chain_id sudah terisi (di-seed oleh sync_ocr dari API)
      - filename IS NULL dan ocr_text IS NULL (belum diproses OCR)

    Klaim dengan mengisi ocr_text='__processing__' (sentinel sementara)
    agar tidak diambil proses OCR paralel.

    Kembalikan (row_id, harvest_chain_id) atau (None, None) bila tidak ada.
    """
    conn = pool.get_connection()
    try:
        conn.start_transaction()
        cur = conn.cursor()
        cur.execute(
            f"SELECT id, harvest_chain_id FROM `{TABLE}` "
            f"WHERE  status           = 'PENDING' "
            f"  AND  harvest_chain_id IS NOT NULL "
            f"  AND  filename         IS NULL "
            f"  AND  ocr_text         IS NULL "
            f"ORDER  BY created_at ASC, id ASC "
            f"LIMIT  1 FOR UPDATE"
        )
        row = cur.fetchone()
        if not row:
            conn.rollback()
            cur.close()
            return None, None

        row_id, hc_id = row
        # Tandai sedang dikerjakan via sentinel di ocr_text
        cur.execute(
            f"UPDATE `{TABLE}` SET ocr_text = '__processing__' WHERE id = %s",
            (row_id,),
        )
        conn.commit()
        cur.close()
        return row_id, hc_id
    except Exception:
        try: conn.rollback()
        except: pass
        raise
    finally:
        conn.close()


def update_ocr_result(pool, row_id, filename, ocr_text, status):
    """UPDATE baris dengan hasil OCR sesungguhnya setelah proses selesai."""
    conn = pool.get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            f"UPDATE `{TABLE}` "
            f"SET filename = %s, ocr_text = %s, status = %s "
            f"WHERE id = %s",
            (filename, ocr_text, status, row_id),
        )
        conn.commit()
        cur.close()
    finally:
        conn.close()


def release_slot(pool, row_id):
    """Kembalikan slot ke kondisi awal bila OCR gagal total."""
    conn = pool.get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            f"UPDATE `{TABLE}` SET ocr_text = NULL "
            f"WHERE id = %s AND ocr_text = '__processing__'",
            (row_id,),
        )
        conn.commit()
        cur.close()
    finally:
        conn.close()


def count_waiting_slots(pool):
    """Hitung slot yang harvest_chain_id sudah ada tapi belum di-OCR."""
    conn = pool.get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            f"SELECT COUNT(*) FROM `{TABLE}` "
            f"WHERE  status           = 'PENDING' "
            f"  AND  harvest_chain_id IS NOT NULL "
            f"  AND  filename         IS NULL "
            f"  AND  ocr_text         IS NULL"
        )
        count = cur.fetchone()[0]
        cur.close()
        return count
    finally:
        conn.close()


# ── Preprocessing ─────────────────────────────────────────────────────────────

def preprocess(name, src_path):
    img = Image.open(src_path)
    if CFG["GRAYSCALE"]:    img = ImageOps.grayscale(img)
    if CFG["UPSCALE_FACTOR"] > 1.0:
        w, h = img.size
        img = img.resize(
            (int(w * CFG["UPSCALE_FACTOR"]), int(h * CFG["UPSCALE_FACTOR"])),
            Image.LANCZOS,
        )
    img = img.filter(ImageFilter.SHARPEN)
    if CFG["INVERT"]:       img = ImageOps.invert(img.convert("L"))
    if CFG["THRESHOLD"]:
        img = ImageOps.autocontrast(img.convert("L"))
        img = img.point(lambda p: 255 if p > 128 else 0)
    img = img.convert("RGB")
    out_dir  = CFG["PREPRO_DIR"] if CFG["SAVE_PREPRO"] else "/tmp"
    out_path = os.path.join(out_dir, os.path.splitext(name)[0] + "_pre.png")
    img.save(out_path)
    return out_path


# ── OCR ───────────────────────────────────────────────────────────────────────

def run_ocr(reader, path):
    allow   = CFG["ALLOWLIST"] or None
    arr     = np.array(Image.open(path).convert("RGB"))
    results = reader.readtext(arr, detail=0, allowlist=allow)
    return "\n".join(str(r) for r in results).strip() if results else ""


def run_ocr_with_retry(reader, path):
    """
    Retry OCR bila kosong ATAU bukan angka murni.
    Kembalikan (text, valid, attempts).
    """
    max_retry = max(1, CFG["OCR_MAX_RETRY"])
    last_text = ""
    for attempt in range(1, max_retry + 1):
        text = run_ocr(reader, path)
        last_text = text
        if not text or text.strip() == "":
            log.warning("  OCR %d/%d: KOSONG, retry...", attempt, max_retry)
            continue
        if not is_valid_number(text):
            log.warning("  OCR %d/%d tidak valid (bukan angka): %r", attempt, max_retry, text)
            continue
        log.info("  OCR %d/%d valid: %r", attempt, max_retry, text)
        return text, True, attempt

    # Semua percobaan habis — file akan dipindah ke failed_ocr/
    if not last_text or last_text.strip() == "":
        log.error(
            "  [GAGAL] OCR %d/%d percobaan: tidak ada teks terdeteksi. "
            "File → failed_ocr/.",
            max_retry, max_retry,
        )
    else:
        log.warning(
            "  [GAGAL] OCR %d/%d percobaan: hasil bukan angka murni (%r). "
            "File → failed_ocr/.",
            max_retry, max_retry, last_text,
        )
    return last_text, False, max_retry


# ── File util ─────────────────────────────────────────────────────────────────

def is_image(name):
    return os.path.splitext(name)[1].lower() in IMAGE_EXTS

def is_stable(path, wait):
    try:    s1 = os.path.getsize(path)
    except: return False
    time.sleep(wait)
    try:    s2 = os.path.getsize(path)
    except: return False
    return s1 == s2 and s1 > 0

def move_file(src, dst):
    try:    os.replace(src, dst)
    except: shutil.move(src, dst)


# ── Proses satu file ──────────────────────────────────────────────────────────

def process_file(reader, pool, name, src_path):
    """
    Proses satu gambar dari ready_ocr/:
      1. Klaim slot DB (harvest_chain_id terisi, filename+ocr_text masih NULL)
      2. Preprocess + OCR
      3. UPDATE baris DB: isi filename + ocr_text + status
      4. Pindah file ke done_ocr/ atau failed_ocr/
    """
    # 1) Klaim slot — harus ada harvest_chain_id dulu dari sync_ocr
    row_id, hc_id = claim_pending_slot(pool)
    if row_id is None:
        log.warning(
            "  %s: tidak ada slot menunggu OCR di DB. "
            "Tunggu sync_ocr seed harvest_chain_id dari API terlebih dahulu.",
            name,
        )
        return  # biarkan file tetap di ready_ocr/, coba lagi siklus berikutnya

    log.info("  %s → klaim slot %s (DB id=%d)", name, hc_id, row_id)

    # 2) Preprocess
    try:
        prepro = preprocess(name, src_path)
    except Exception as e:
        log.error("GAGAL preprocess %s: %s", name, e)
        release_slot(pool, row_id)
        move_file(src_path, os.path.join(CFG["FAIL_DIR"], name))
        return

    # 3) OCR
    try:
        text, valid, attempts = run_ocr_with_retry(reader, prepro)
    except Exception as e:
        log.error("GAGAL OCR %s: %s", name, e, exc_info=True)
        release_slot(pool, row_id)
        move_file(src_path, os.path.join(CFG["FAIL_DIR"], name))
        return
    finally:
        if not CFG["SAVE_PREPRO"]:
            try:    os.remove(prepro)
            except: pass

    # OCR gagal (tidak valid setelah semua retry) → file ke failed_ocr/
    # Slot DB dibebaskan agar bisa dipakai gambar lain yang lebih jelas.
    if not valid:
        log.warning(
            "GAGAL OCR %s → failed_ocr/ (tidak valid setelah %d percobaan, "
            "hasil terakhir: %r). Slot %s dibebaskan.",
            name, attempts, text, hc_id,
        )
        release_slot(pool, row_id)
        move_file(src_path, os.path.join(CFG["FAIL_DIR"], name))
        return

    # OCR valid → UPDATE DB dengan status PENDING
    # 4) UPDATE DB
    try:
        update_ocr_result(pool, row_id, name, text, "PENDING")
    except Exception as e:
        log.error("GAGAL update DB %s (id=%d): %s", name, row_id, e)
        release_slot(pool, row_id)
        move_file(src_path, os.path.join(CFG["FAIL_DIR"], name))
        return

    # Arsip .txt
    txt = os.path.join(CFG["OUTPUT_DIR"], os.path.splitext(name)[0] + ".txt")
    try:
        with open(txt, "w", encoding="utf-8") as f:
            f.write(text)
    except OSError as e:
        log.warning("tulis hasil %s: %s", txt, e)

    move_file(src_path, os.path.join(CFG["DONE_DIR"], name))

    preview = text[:60] + ("..." if len(text) > 60 else "")
    log.info(
        "OK   %s → DB id=%d (%s, PENDING, siap dikirim sync_ocr) | %r",
        name, row_id, hc_id, preview,
    )


# ── Scan folder ───────────────────────────────────────────────────────────────

def _cleanup_ready_ocr():
    """
    Hapus SEMUA file yang masih tersisa di ready_ocr/ setelah siklus proses selesai.

    Dipanggil SETELAH process_file memindahkan file gagal ke failed_ocr/.
    Urutan yang dijamin:
      1. process_file: file gagal OCR 3x → pindah ke failed_ocr/
      2. _cleanup_ready_ocr: hapus sisa file apapun di ready_ocr/

    File yang dihapus:
      - Semua file gambar yang masih ada (seharusnya sudah dipindah
        ke done_ocr/ atau failed_ocr/ oleh process_file, tapi
        mungkin tertinggal karena tidak ada slot / tidak stabil)
      - File non-gambar dan file 0 byte
    """
    try:
        entries = os.listdir(CFG["INPUT_DIR"])
    except OSError:
        return

    removed = 0
    for name in entries:
        path = os.path.join(CFG["INPUT_DIR"], name)
        if not os.path.isfile(path):
            continue
        try:
            os.remove(path)
            log.info("[Cleanup] Hapus dari ready_ocr/: %s", name)
            removed += 1
        except OSError as e:
            log.warning("[Cleanup] Gagal hapus %s: %s", name, e)

    if removed:
        log.info("[Cleanup] ready_ocr/ kosong: %d file dihapus.", removed)
    else:
        log.info("[Cleanup] ready_ocr/ sudah kosong.")


def scan_once(reader, pool):
    """
    Proses gambar di ready_ocr/ hanya bila ada slot menunggu OCR di DB.
    Slot = baris dengan harvest_chain_id terisi tapi filename & ocr_text masih NULL.
    """
    waiting = count_waiting_slots(pool)
    if waiting == 0:
        log.info(
            "[OCR] Tidak ada slot menunggu OCR. "
            "Tunggu sync_ocr seed harvest_chain_id dari /api/harvests."
        )
        return

    try:
        entries = os.listdir(CFG["INPUT_DIR"])
    except OSError as e:
        log.error("baca folder input: %s", e)
        return

    images = sorted([
        n for n in entries
        if os.path.isfile(os.path.join(CFG["INPUT_DIR"], n)) and is_image(n)
    ])
    if not images:
        return

    log.info("[OCR] %d slot menunggu, %d gambar di ready_ocr/.", waiting, len(images))

    processed = 0
    for name in images:
        if count_waiting_slots(pool) == 0:
            log.info("[OCR] Slot habis. Sisa gambar menunggu harvest baru dari API.")
            break
        src = os.path.join(CFG["INPUT_DIR"], name)
        if not os.path.isfile(src) or not is_stable(src, CFG["STABLE_WAIT"]):
            continue
        process_file(reader, pool, name, src)
        processed += 1

    # Setelah semua file diproses, bersihkan sisa file di ready_ocr/
    # yang masih tertinggal (tidak stabil / bukan gambar / tidak ada slot).
    # File yang sudah berhasil sudah pindah ke done_ocr/ atau failed_ocr/
    # oleh process_file. Yang tersisa adalah file yang belum bisa diproses
    # karena tidak ada slot harvest_chain_id — biarkan, jangan hapus.
    _cleanup_ready_ocr()


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    for d in (CFG["DONE_DIR"], CFG["FAIL_DIR"], CFG["OUTPUT_DIR"]):
        os.makedirs(d, exist_ok=True)
    if CFG["SAVE_PREPRO"]:
        os.makedirs(CFG["PREPRO_DIR"], exist_ok=True)

    pool = make_pool()
    init_schema(pool)

    langs = [s.strip() for s in CFG["OCR_LANG"].split(",") if s.strip()]
    log.info("Memuat model EasyOCR (lang=%s, gpu=%s)...", langs, CFG["USE_GPU"])
    reader = easyocr.Reader(langs, gpu=CFG["USE_GPU"])
    log.info(
        "Model siap. Memantau '%s' tiap %.1fs | max retry=%d\n"
        "Urutan: sync_ocr seed harvest_chain_id dulu → ocr_watcher isi OCR → sync_ocr kirim.\n"
        "Ctrl+C untuk berhenti.",
        CFG["INPUT_DIR"], CFG["POLL_INTERVAL"], CFG["OCR_MAX_RETRY"],
    )

    try:
        while True:
            scan_once(reader, pool)
            time.sleep(CFG["POLL_INTERVAL"])
    except KeyboardInterrupt:
        log.info("Berhenti.")


if __name__ == "__main__":
    main()
