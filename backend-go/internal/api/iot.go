package api

import (
	"io"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"blockagrichain/backend/internal/models"
	"blockagrichain/backend/internal/ocr"
)

// iotWeight — POST /api/iot/weight  (multipart/form-data)
//
//	Header : X-IoT-Key: <kunci>   (wajib bila IOT_API_KEY di-set)
//	Field  : harvestId  ATAU  harvestChainId   (panen yang sedang ditimbang)
//	File   : image      (foto display timbangan dari ESP32-CAM)
//
// Alur (skema baru): ESP32 kirim GAMBAR → server simpan ke S3 → OCR di server
// (Tesseract) → berat tersimpan di panen → muncul di layar verifikasi Bulog.
// Endpoint TIDAK pakai JWT (perangkat ESP), tapi dilindungi X-IoT-Key.
func (s *Server) iotWeight(w http.ResponseWriter, r *http.Request) {
	if s.cfg.IoTApiKey != "" && r.Header.Get("X-IoT-Key") != s.cfg.IoTApiKey {
		s.json(w, http.StatusUnauthorized, map[string]any{"error": "X-IoT-Key salah / tidak ada"})
		return
	}
	if err := r.ParseMultipartForm(12 << 20); err != nil {
		s.bad(w, "form tidak valid — kirim multipart/form-data")
		return
	}

	var h models.Harvest
	if idStr := r.FormValue("harvestId"); idStr != "" {
		id, _ := strconv.ParseInt(idStr, 10, 64)
		s.db.First(&h, id)
	} else if cid := r.FormValue("harvestChainId"); cid != "" {
		s.db.Where("harvest_chain_id = ?", cid).First(&h)
	}
	if h.ID == 0 {
		s.notFound(w, "Panen tidak ditemukan (sertakan harvestId / harvestChainId)")
		return
	}

	// Ambil SEMUA part bernama "image" lalu pilih yang terbesar — Postman kadang
	// menyertakan field "image" placeholder (postman-cloud://) berukuran 0 byte di
	// depan file asli; tanpa ini server bisa memproses file kosong → OCR gagal.
	files := r.MultipartForm.File["image"]
	if len(files) == 0 {
		s.bad(w, "field 'image' wajib (foto display timbangan)")
		return
	}
	hdr := files[0]
	for _, fh := range files {
		if fh.Size > hdr.Size {
			hdr = fh
		}
	}
	file, err := hdr.Open()
	if err != nil {
		s.bad(w, "gagal membuka gambar")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, 12<<20))
	if err != nil {
		s.bad(w, "gagal membaca gambar")
		return
	}

	ct := hdr.Header.Get("Content-Type")
	if ct == "" {
		ct = "image/jpeg"
	}
	imgURL, _, err := s.s3.Put(r.Context(), "iot", hdr.Filename, ct, data)
	if err != nil {
		s.fail(w, err)
		return
	}

	raw, val := "", 0.0
	if ocr.Available() {
		if rw, v, e := ocr.Extract(r.Context(), data); e == nil {
			raw, val = rw, v
		}
	}

	h.IoTImageURL = &imgURL
	if raw != "" {
		h.IoTOcrRaw = &raw
	}
	if val > 0 {
		h.IoTWeightKg = &val
	}
	s.db.Save(&h)

	s.notify(models.RoleBulog, "IoTReading", "Data timbangan IoT diterima",
		"Foto + hasil OCR untuk panen "+h.HarvestChainID+" siap diverifikasi.", "", nil)

	s.json(w, http.StatusOK, map[string]any{
		"harvestId": h.ID, "imageFile": hdr.Filename, "ocrRaw": raw,
		"ocrWeight": val, "ocrAvailable": ocr.Available(),
	})
}

// iotImage — GET /api/iot/image/{id}  (Bulog) — proxy gambar timbangan dari S3
// privat ke FE, sehingga bucket tetap private tapi gambar tampil di verifikasi.
func (s *Server) iotImage(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	var h models.Harvest
	if err := s.db.First(&h, id).Error; err != nil || h.IoTImageURL == nil || *h.IoTImageURL == "" {
		s.notFound(w, "Gambar tidak ditemukan")
		return
	}
	data, ct, err := s.s3.GetByURL(r.Context(), *h.IoTImageURL)
	if err != nil {
		s.fail(w, err)
		return
	}
	if ct == "" {
		ct = "image/jpeg"
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Cache-Control", "private, max-age=300")
	_, _ = w.Write(data)
}
