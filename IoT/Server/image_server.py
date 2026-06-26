#!/usr/bin/env python3

import os
import mysql.connector
from datetime import datetime
from flask import Flask, request, jsonify

# ── Konfigurasi ──────────────────────────────────────────────────────────────
OUTPUT_DIR_OCR   = "ready_ocr"
OUTPUT_DIR_PANEN = "gambar-hasil-panen"
HOST             = "0.0.0.0"
PORT             = 5000
MAX_CONTENT_MB   = 16

DB_CONFIG = {
    "host"    : os.environ.get("DB_HOST", "127.0.0.1"),
    "port"    : int(os.environ.get("DB_PORT", "3306")),
    "user"    : os.environ.get("DB_USER", "agri"),
    "password": os.environ.get("DB_PASS", "BlockAgriChain"),
    "database": os.environ.get("DB_NAME", "BlockAgriChain"),
}
# ─────────────────────────────────────────────────────────────────────────────

os.makedirs(OUTPUT_DIR_OCR,   exist_ok=True)
os.makedirs(OUTPUT_DIR_PANEN, exist_ok=True)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_MB * 1024 * 1024


# ── Helper: koneksi DB ────────────────────────────────────────────────────────
def get_db():
    """Buka koneksi baru ke MySQL dan kembalikan (conn, cursor)."""
    conn   = mysql.connector.connect(**DB_CONFIG)
    cursor = conn.cursor(dictionary=True)
    return conn, cursor


# ── Helper: simpan JPEG ke disk ───────────────────────────────────────────────
def save_jpeg(raw: bytes, device_id: str, ts: str, output_dir: str) -> str:
    """
    Validasi header/footer JPEG lalu simpan ke output_dir.
    Kembalikan path lengkap file yang disimpan.
    """
    if not (raw[:2] == b"\xff\xd8" and raw[-2:] == b"\xff\xd9"):
        print(
            f"[!] Peringatan: data device {device_id} bukan JPEG utuh "
            f"(SOI={raw[:2]!r} EOI={raw[-2:]!r}), tetap disimpan."
        )
    recv     = datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:-3]
    filename = f"cam{device_id}_{ts}_{recv}.jpg"
    path     = os.path.join(output_dir, filename)
    with open(path, "wb") as f:
        f.write(raw)
    print(f"[+] Tersimpan: {path} ({len(raw)} bytes)")
    return path


# ── Helper: baca body gambar dari request ─────────────────────────────────────
# Nama field multipart yang umum dipakai ESP32-CAM di berbagai sketch
_IMAGE_FIELD_CANDIDATES = ("image", "imageFile", "file", "photo", "data", "jpeg")

def extract_raw_image() -> bytes | None:
    """
    Baca gambar dari request. Urutan pengecekan:
      1. multipart/form-data — coba field: image, imageFile, file, photo, data, jpeg
         (fleksibel terhadap variasi nama field di sketch .ino)
      2. Fallback: raw body (Content-Type: image/jpeg atau application/octet-stream)
    Kembalikan bytes atau None jika tidak ada data gambar.
    """
    # Coba setiap kandidat nama field multipart
    for field in _IMAGE_FIELD_CANDIDATES:
        if field in request.files:
            data = request.files[field].read()
            if data:
                print(f"[extract] field='{field}' size={len(data)} bytes")
                return data

    # Fallback: bila ESP32 kirim raw body tanpa multipart
    if request.data:
        print(f"[extract] raw body size={len(request.data)} bytes")
        return request.data

    # Log semua field yang diterima untuk debugging
    if request.files:
        print(f"[extract] WARNING: files diterima tapi tidak ada yang cocok. "
              f"Field tersedia: {list(request.files.keys())}")
    return None


# ══════════════════════════════════════════════════════════════════════════════
# ENDPOINT 1 — IoT ke-2: upload gambar hasil panen
# (harus dieksekusi SEBELUM IoT ke-1 bisa upload untuk baris yang sama)
# ══════════════════════════════════════════════════════════════════════════════
@app.route("/upload-hasil-panen", methods=["POST"])
def upload_hasil_panen():
    """
    Terima gambar dari IoT ke-2 (hasil panen).
    Simpan ke gambar-hasil-panen/, lalu update kolom filename_hasil_panen
    pada baris ocr_results yang sesuai.

    Strategi match baris ocr_results:
      • Jika header X-Ocr-Result-Id dikirim → update baris dengan id tersebut.
      • Jika tidak → ambil baris terbaru (ORDER BY id DESC LIMIT 1)
        yang filename_hasil_panen masih NULL.
    """
    device_id    = request.headers.get("X-Device-Id",     "02")
    ts           = request.headers.get("X-Timestamp",     "0")
    ocr_result_id = request.headers.get("X-Ocr-Result-Id", None)

    # 0) Debug log — catat content-type dan field yang masuk untuk diagnosis
    print(f"[upload-hasil-panen] Content-Type : {request.content_type}")
    print(f"[upload-hasil-panen] Files fields : {list(request.files.keys())}")
    print(f"[upload-hasil-panen] Raw body size: {len(request.data)} bytes")

    # 1) Baca gambar (fleksibel terhadap nama field apapun dari ESP32-CAM)
    raw = extract_raw_image()
    if not raw:
        return jsonify({
            "ok"    : False,
            "error" : "no image data",
            "hint"  : "Pastikan sketch .ino mengirim gambar dengan field name yang "
                      "dikenal: image / imageFile / file / photo / data / jpeg, "
                      "atau kirim sebagai raw body dengan Content-Type: image/jpeg",
            "fields": list(request.files.keys()),
        }), 400

    # 2) Cross-check DB — cari baris target & pastikan filename_hasil_panen masih NULL
    #    Aturan: satu baris hanya boleh menerima satu gambar hasil panen.
    #    Jika kolom sudah terisi, upload ditolak (HTTP 409) tanpa menyimpan file.
    conn, cursor = get_db()
    try:
        if ocr_result_id:
            # Cek baris spesifik
            cursor.execute(
                """
                SELECT id, filename_hasil_panen
                FROM   ocr_results
                WHERE  id = %s
                """,
                (ocr_result_id,),
            )
            row = cursor.fetchone()
            if not row:
                return jsonify({
                    "ok"   : False,
                    "error": f"ocr_result id={ocr_result_id} tidak ditemukan",
                }), 404
            matched_id = row["id"]
        else:
            # Ambil baris terbaru yang filename_hasil_panen masih NULL
            cursor.execute(
                """
                SELECT id, filename_hasil_panen
                FROM   ocr_results
                WHERE  filename_hasil_panen IS NULL
                ORDER  BY id DESC
                LIMIT  1
                """
            )
            row = cursor.fetchone()
            if not row:
                return jsonify({
                    "ok"   : False,
                    "error": "Tidak ada baris ocr_results yang menunggu filename_hasil_panen. "
                             "Semua baris sudah memiliki gambar hasil panen.",
                }), 404
            matched_id = row["id"]

        # Tolak bila kolom sudah terisi (duplikat upload)
        existing = row.get("filename_hasil_panen")
        if existing:
            print(
                f"[!] Upload DITOLAK (duplikat) — ocr_results.id={matched_id} "
                f"sudah memiliki filename_hasil_panen='{existing}'"
            )
            return jsonify({
                "ok"                  : False,
                "error"               : "Upload ditolak: gambar hasil panen untuk data ini "
                                        "sudah pernah dikirim sebelumnya.",
                "ocr_result_id"       : matched_id,
                "filename_hasil_panen": existing,
            }), 409

    except mysql.connector.Error as e:
        return jsonify({"ok": False, "error": f"DB error: {e}"}), 500
    finally:
        cursor.close()
        conn.close()

    # 3) Lolos cross-check → simpan ke disk
    path     = save_jpeg(raw, device_id, ts, OUTPUT_DIR_PANEN)
    filename = os.path.basename(path)

    # 4) Update DB
    conn, cursor = get_db()
    try:
        cursor.execute(
            """
            UPDATE ocr_results
            SET    filename_hasil_panen = %s
            WHERE  id = %s
            """,
            (filename, matched_id),
        )
        conn.commit()
        print(f"[DB] ocr_results.id={matched_id} → filename_hasil_panen='{filename}'")

    except mysql.connector.Error as e:
        conn.rollback()
        # File sudah tersimpan tapi DB gagal — hapus file agar tidak orphan
        try:
            os.remove(path)
            print(f"[!] File dihapus karena DB gagal diupdate: {path}")
        except OSError:
            pass
        return jsonify({"ok": False, "error": f"DB error: {e}"}), 500
    finally:
        cursor.close()
        conn.close()

    return jsonify({
        "ok"            : True,
        "saved"         : filename,
        "bytes"         : len(raw),
        "ocr_result_id" : matched_id,
        "message"       : f"filename_hasil_panen diperbarui untuk ocr_results.id={matched_id}",
    }), 200


# ══════════════════════════════════════════════════════════════════════════════
# ENDPOINT 2 — IoT ke-1: upload gambar (dengan cross-check)
# ══════════════════════════════════════════════════════════════════════════════
@app.route("/upload", methods=["POST"])
def upload():
    """
    Terima gambar dari IoT ke-1.
    CROSS-CHECK: sebelum menyimpan, periksa apakah baris ocr_results terbaru
    sudah memiliki filename_hasil_panen terisi.

    Logika cross-check:
      • Jika header X-Ocr-Result-Id dikirim → cek baris dengan id tsb.
      • Jika tidak → cek baris terbaru (ORDER BY id DESC LIMIT 1).

    Jika filename_hasil_panen masih NULL/kosong → tolak dengan HTTP 403.
    """
    device_id     = request.headers.get("X-Device-Id",     "01")
    ts            = request.headers.get("X-Timestamp",     "0")
    ocr_result_id = request.headers.get("X-Ocr-Result-Id", None)

    # 1) Baca gambar dulu (sebelum hit DB, hindari koneksi sia-sia)
    raw = extract_raw_image()
    if not raw:
        return jsonify({"ok": False, "error": "no image data"}), 400

    # 2) Cross-check DB
    conn, cursor = get_db()
    try:
        if ocr_result_id:
            cursor.execute(
                """
                SELECT id, filename_hasil_panen
                FROM   ocr_results
                WHERE  id = %s
                """,
                (ocr_result_id,),
            )
            row = cursor.fetchone()
            if not row:
                return jsonify({
                    "ok"   : False,
                    "error": f"ocr_result id={ocr_result_id} tidak ditemukan",
                }), 404
        else:
            cursor.execute(
                """
                SELECT id, filename_hasil_panen
                FROM   ocr_results
                ORDER  BY id DESC
                LIMIT  1
                """
            )
            row = cursor.fetchone()
            if not row:
                return jsonify({
                    "ok"   : False,
                    "error": "Tabel ocr_results kosong; tidak ada data untuk di-cross-check",
                }), 404

    except mysql.connector.Error as e:
        return jsonify({"ok": False, "error": f"DB error: {e}"}), 500
    finally:
        cursor.close()
        conn.close()

    # 3) Evaluasi hasil cross-check
    fn_panen = row.get("filename_hasil_panen")
    if not fn_panen:
        print(
            f"[!] Upload DITOLAK — ocr_results.id={row['id']} "
            f"belum memiliki filename_hasil_panen."
        )
        return jsonify({
            "ok"           : False,
            "error"        : "Upload ditolak: gambar hasil panen (IoT ke-2) "
                             "belum diterima untuk data ini. "
                             "Pastikan IoT ke-2 mengupload terlebih dahulu.",
            "ocr_result_id": row["id"],
            "hint"         : "POST /upload-hasil-panen dengan header "
                             f"X-Ocr-Result-Id: {row['id']}",
        }), 403

    # 4) Lolos cross-check → simpan gambar
    print(
        f"[✓] Cross-check OK — ocr_results.id={row['id']} "
        f"filename_hasil_panen='{fn_panen}'"
    )
    path = save_jpeg(raw, device_id, ts, OUTPUT_DIR_OCR)

    return jsonify({
        "ok"                 : True,
        "saved"              : os.path.basename(path),
        "bytes"              : len(raw),
        "ocr_result_id"      : row["id"],
        "filename_hasil_panen": fn_panen,
    }), 200


# ══════════════════════════════════════════════════════════════════════════════
# ENDPOINT 3 — Health check
# ══════════════════════════════════════════════════════════════════════════════
@app.route("/health", methods=["GET"])
def health():
    """Cek apakah server dan koneksi DB berjalan normal."""
    db_ok  = True
    db_err = None
    try:
        conn, cursor = get_db()
        cursor.execute("SELECT 1")
        cursor.close()
        conn.close()
    except Exception as e:
        db_ok  = False
        db_err = str(e)

    status = 200 if db_ok else 503
    return jsonify({
        "ok"    : db_ok,
        "db"    : "connected" if db_ok else f"error: {db_err}",
        "server": "running",
    }), status


# ══════════════════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    print(f"[*] Listening di http://{HOST}:{PORT}")
    print(f"    POST /upload              → folder '{OUTPUT_DIR_OCR}/'")
    print(f"    POST /upload-hasil-panen  → folder '{OUTPUT_DIR_PANEN}/'")
    print(f"    GET  /health")
    app.run(host=HOST, port=PORT, threaded=True)
