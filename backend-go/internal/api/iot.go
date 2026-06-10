package api

import (
	"io"
	"net/http"
	"strconv"
	"strings"

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
	if !s.iotAuthorized(w, r) {
		return
	}
	if err := r.ParseMultipartForm(12 << 20); err != nil {
		s.bad(w, "form tidak valid — kirim multipart/form-data")
		return
	}

	h, ok := s.iotFindHarvest(w, r)
	if !ok {
		return
	}

	// ID perangkat IoT: dari header X-Device-Id (perangkat ESP) atau field 'deviceId'.
	deviceID := r.Header.Get("X-Device-Id")
	if deviceID == "" {
		deviceID = r.FormValue("deviceId")
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
	if deviceID != "" {
		h.IoTDeviceID = &deviceID
	}
	if raw != "" {
		h.IoTOcrRaw = &raw
	}
	if val > 0 {
		h.IoTWeightKg = &val
	}
	if pile := s.iotOptionalImage(r, "pileImage"); pile != "" { // foto tumpukan panen versi Bulog
		h.BulogPhotoURL = &pile
	}
	s.db.Save(&h)

	devNote := ""
	if deviceID != "" {
		devNote = " (perangkat " + deviceID + ")"
	}
	s.notify(models.RoleBulog, "IoTReading", "Data timbangan IoT diterima",
		"Foto + hasil OCR untuk panen "+h.HarvestChainID+devNote+" siap diverifikasi.", "", nil)

	s.json(w, http.StatusOK, map[string]any{
		"harvestId": h.ID, "deviceId": deviceID, "imageFile": hdr.Filename, "ocrRaw": raw,
		"ocrWeight": val, "ocrAvailable": ocr.Available(),
	})
}

// iotAuthorized — otorisasi fleksibel untuk endpoint IoT: terima Bearer JWT
// (login web/Postman) ATAU X-IoT-Key (perangkat ESP32). Menulis 401 & return
// false bila gagal.
func (s *Server) iotAuthorized(w http.ResponseWriter, r *http.Request) bool {
	if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		if _, err := s.auth.Verify(strings.TrimPrefix(h, "Bearer ")); err != nil {
			s.json(w, http.StatusUnauthorized, map[string]any{"error": "Bearer token tidak valid"})
			return false
		}
		return true
	}
	if s.cfg.IoTApiKey != "" && r.Header.Get("X-IoT-Key") != s.cfg.IoTApiKey {
		s.json(w, http.StatusUnauthorized, map[string]any{"error": "Bearer token atau X-IoT-Key wajib"})
		return false
	}
	return true
}

// iotOptionalImage — baca part file opsional (pilih terbesar), unggah ke S3,
// kembalikan URL. "" bila tidak ada / gagal. Dipakai untuk foto tumpukan panen
// versi Bulog yang dikirim bersama data IoT.
func (s *Server) iotOptionalImage(r *http.Request, field string) string {
	files := r.MultipartForm.File[field]
	if len(files) == 0 {
		return ""
	}
	hdr := files[0]
	for _, fh := range files {
		if fh.Size > hdr.Size {
			hdr = fh
		}
	}
	f, e := hdr.Open()
	if e != nil {
		return ""
	}
	defer f.Close()
	data, e2 := io.ReadAll(io.LimitReader(f, 12<<20))
	if e2 != nil {
		return ""
	}
	ct := hdr.Header.Get("Content-Type")
	if ct == "" {
		ct = "image/jpeg"
	}
	u, _, e3 := s.s3.Put(r.Context(), "iot", hdr.Filename, ct, data)
	if e3 != nil {
		return ""
	}
	return u
}

// iotFindHarvest — cari panen dari field 'harvestId' atau 'harvestChainId'.
func (s *Server) iotFindHarvest(w http.ResponseWriter, r *http.Request) (models.Harvest, bool) {
	var h models.Harvest
	if idStr := r.FormValue("harvestId"); idStr != "" {
		id, _ := strconv.ParseInt(idStr, 10, 64)
		s.db.First(&h, id)
	} else if cid := r.FormValue("harvestChainId"); cid != "" {
		s.db.Where("harvest_chain_id = ?", cid).First(&h)
	}
	if h.ID == 0 {
		s.notFound(w, "Panen tidak ditemukan (sertakan harvestId / harvestChainId)")
		return h, false
	}
	return h, true
}

// iotWeightValue — POST /api/iot-value/weight (multipart/form-data)
//
//	Otorisasi : Bearer JWT  ATAU  X-IoT-Key
//	Field     : harvestId / harvestChainId, ocrWeight (berat kg, WAJIB),
//	            deviceId (opsional), image (file, OPSIONAL sebagai bukti)
//
// Berbeda dari /iot/weight: berat dikirim LANGSUNG tanpa OCR (perangkat membaca
// angka sendiri / input manual). Bila gambar disertakan, ikut disimpan ke S3.
func (s *Server) iotWeightValue(w http.ResponseWriter, r *http.Request) {
	if !s.iotAuthorized(w, r) {
		return
	}
	if err := r.ParseMultipartForm(12 << 20); err != nil {
		s.bad(w, "form tidak valid — kirim multipart/form-data")
		return
	}
	h, ok := s.iotFindHarvest(w, r)
	if !ok {
		return
	}

	val, perr := strconv.ParseFloat(strings.TrimSpace(r.FormValue("ocrWeight")), 64)
	if perr != nil || val <= 0 {
		s.bad(w, "field 'ocrWeight' wajib berupa angka berat (kg) > 0")
		return
	}

	deviceID := r.Header.Get("X-Device-Id")
	if deviceID == "" {
		deviceID = r.FormValue("deviceId")
	}

	// Gambar opsional sebagai bukti — pilih part terbesar bila ada.
	var imgURL string
	if files := r.MultipartForm.File["image"]; len(files) > 0 {
		hdr := files[0]
		for _, fh := range files {
			if fh.Size > hdr.Size {
				hdr = fh
			}
		}
		if f, e := hdr.Open(); e == nil {
			defer f.Close()
			if data, e2 := io.ReadAll(io.LimitReader(f, 12<<20)); e2 == nil {
				ct := hdr.Header.Get("Content-Type")
				if ct == "" {
					ct = "image/jpeg"
				}
				if u, _, e3 := s.s3.Put(r.Context(), "iot", hdr.Filename, ct, data); e3 == nil {
					imgURL = u
				}
			}
		}
	}

	h.IoTWeightKg = &val
	if imgURL != "" {
		h.IoTImageURL = &imgURL
	}
	if deviceID != "" {
		h.IoTDeviceID = &deviceID
	}
	if pile := s.iotOptionalImage(r, "pileImage"); pile != "" { // foto tumpukan panen versi Bulog
		h.BulogPhotoURL = &pile
	}
	src := "value(direct)"
	h.IoTOcrRaw = &src
	s.db.Save(&h)

	devNote := ""
	if deviceID != "" {
		devNote = " (perangkat " + deviceID + ")"
	}
	s.notify(models.RoleBulog, "IoTReading", "Data berat IoT diterima",
		"Berat timbangan untuk panen "+h.HarvestChainID+devNote+" siap diverifikasi.", "", nil)

	s.json(w, http.StatusOK, map[string]any{
		"harvestId": h.ID, "deviceId": deviceID, "ocrWeight": val, "hasImage": imgURL != "",
	})
}

// harvestPhoto — GET /api/harvests/{id}/photo?kind=harvest|iot|bulog (Bulog).
// Proxy gambar privat dari S3 agar tampil di layar verifikasi tanpa expose bucket.
func (s *Server) harvestPhoto(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	var h models.Harvest
	if err := s.db.First(&h, id).Error; err != nil {
		s.notFound(w, "Panen tidak ditemukan")
		return
	}
	var url *string
	switch r.URL.Query().Get("kind") {
	case "harvest":
		url = h.HarvestPhotoURL
	case "bulog":
		url = h.BulogPhotoURL
	default:
		url = h.IoTImageURL
	}
	if url == nil || *url == "" {
		s.notFound(w, "Gambar tidak ditemukan")
		return
	}
	data, ct, err := s.s3.GetByURL(r.Context(), *url)
	if err != nil {
		s.fail(w, err)
		return
	}
	if ct == "" {
		ct = "image/jpeg"
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Cache-Control", "private, max-age=120")
	_, _ = w.Write(data)
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
