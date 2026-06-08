// Package ocr — ekstraksi angka berat dari gambar display timbangan (kiriman
// ESP32-CAM) memakai Tesseract OCR (binary `tesseract`, dipasang di image Docker).
// Sesuai skema: ESP32 kirim gambar → OCR di server (EC2) → berat untuk verifikasi Bulog.
package ocr

import (
	"context"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
)

var numRe = regexp.MustCompile(`[0-9]+(?:[.,][0-9]+)?`)

// Available — apakah binary tesseract tersedia.
func Available() bool {
	_, err := exec.LookPath("tesseract")
	return err == nil
}

// Extract — OCR gambar (byte) → teks mentah + angka terbaca.
// --psm 7 (satu baris) + whitelist digit → akurasi tinggi untuk display angka.
func Extract(ctx context.Context, img []byte) (raw string, value float64, err error) {
	f, err := os.CreateTemp("", "iot-*.jpg")
	if err != nil {
		return "", 0, err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(img); err != nil {
		f.Close()
		return "", 0, err
	}
	f.Close()

	// Coba beberapa Page Segmentation Mode: 7 (satu baris), 6 (blok), 11 (teks
	// jarang), 13 (baris mentah). Display timbangan/LCD tak selalu terbaca di satu
	// mode; pakai mode pertama yang menghasilkan angka.
	for _, psm := range []string{"7", "6", "11", "13"} {
		cmd := exec.CommandContext(ctx, "tesseract", f.Name(), "stdout",
			"--psm", psm, "-c", "tessedit_char_whitelist=0123456789.,")
		out, e := cmd.Output()
		if e != nil {
			err = e
			continue
		}
		raw = strings.TrimSpace(string(out))
		if m := numRe.FindString(raw); m != "" {
			value, _ = strconv.ParseFloat(strings.ReplaceAll(m, ",", "."), 64)
			return raw, value, nil
		}
	}
	return raw, 0, err
}
