#!/usr/bin/env python3

import os
import sys
import time
import signal
import logging
import argparse

import mysql.connector
from mysql.connector import pooling

# ---------- Konfigurasi (samakan dengan ocr_watcher) ----------

DB = {
    "host":     os.environ.get("DB_HOST", "127.0.0.1"),
    "port":     int(os.environ.get("DB_PORT", "3306")),
    "user":     os.environ.get("DB_USER", "agri"),
    "password": os.environ.get("DB_PASS", "BlockAgriChain"),
    "database": os.environ.get("DB_NAME", "BlockAgriChain"),
    "charset":  "utf8mb4",
}
TABLE = os.environ.get("DB_TABLE", "ocr_results")
CLEAN_INTERVAL = float(os.environ.get("CLEAN_INTERVAL_S", "5"))

# Kolom dianggap "kotor" dan dihapus bila:
#   1) NULL,
#   2) kosong / hanya whitespace,
#   3) mengandung spasi (CHAR 32), tab (CHAR 9), newline (CHAR 10), CR (CHAR 13),
#   4) mengandung karakter spesial: REGEXP menolak apa pun selain digit 0-9.
#
# Catatan: ocr_text NOT REGEXP '^[0-9]+$' sudah mencakup kasus spasi & karakter
# spesial sekaligus (apa pun yang bukan barisan digit murni dianggap kotor).
# Pengecekan spasi/tab/newline ditulis eksplisit agar maksudnya jelas dan
# tetap aman bila REGEXP berperilaku beda di konfigurasi MySQL tertentu.
DIRTY_CONDITION = (
    "ocr_text IS NULL "
    "OR TRIM(REPLACE(REPLACE(REPLACE(ocr_text, CHAR(9), ' '), "
    "CHAR(10), ' '), CHAR(13), ' ')) = '' "
    "OR ocr_text LIKE '% %' "                       # ada spasi
    "OR ocr_text LIKE CONCAT('%', CHAR(9), '%') "   # ada tab
    "OR ocr_text LIKE CONCAT('%', CHAR(10), '%') "  # ada newline
    "OR ocr_text LIKE CONCAT('%', CHAR(13), '%') "  # ada carriage return
    "OR ocr_text NOT REGEXP '^[0-9]+$'"             # ada karakter selain digit
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("clean")

# Flag berhenti yang aman untuk SIGTERM/SIGINT (mis. saat dijadikan service)
_running = True


def _stop(signum, frame):
    global _running
    _running = False
    log.info("Sinyal berhenti diterima, menutup...")


def make_pool():
    return pooling.MySQLConnectionPool(
        pool_name="clean_pool",
        pool_size=2,
        **DB,
    )


def clean_once(pool):
    """Hapus baris ocr_text kotor sekali. Kembalikan jumlah baris dihapus."""
    conn = pool.get_connection()
    try:
        cur = conn.cursor()
        cur.execute(f"DELETE FROM {TABLE} WHERE {DIRTY_CONDITION}")
        conn.commit()
        deleted = cur.rowcount
        cur.close()
        return deleted
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(
        description="Bersihkan baris ocr_text yang kosong / berisi spasi / karakter spesial."
    )
    parser.add_argument("--interval", type=float, default=None,
                        help="interval polling dalam detik (default 5)")
    args = parser.parse_args()

    interval = args.interval if args.interval is not None else CLEAN_INTERVAL

    signal.signal(signal.SIGINT, _stop)
    signal.signal(signal.SIGTERM, _stop)

    try:
        pool = make_pool()
    except mysql.connector.Error as e:
        log.error("Gagal membuat connection pool: %s", e)
        sys.exit(1)

    log.info("Mulai pembersihan realtime tabel '%s' tiap %.1fs. "
             "Hanya ocr_text angka murni yang dipertahankan. Ctrl+C untuk berhenti.",
             TABLE, interval)

    total_deleted = 0
    while _running:
        try:
            n = clean_once(pool)
            if n > 0:
                total_deleted += n
                log.info("Hapus %d baris kotor (akumulatif: %d).", n, total_deleted)
        except mysql.connector.Error as e:
            # jangan crash hanya karena DB sempat tidak tersedia; coba lagi
            log.error("Error DB saat membersihkan: %s", e)

        # tidur dengan tetap responsif terhadap sinyal berhenti
        slept = 0.0
        step = 0.5
        while _running and slept < interval:
            time.sleep(step)
            slept += step

    log.info("Berhenti. Total baris dihapus selama sesi ini: %d.", total_deleted)


if __name__ == "__main__":
    main()
