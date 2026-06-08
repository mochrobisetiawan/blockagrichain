// Package ocr — ekstraksi angka berat dari gambar display timbangan (kiriman
// ESP32-CAM) memakai Tesseract OCR (binary `tesseract`, dipasang di image Docker).
// Sesuai skema: ESP32 kirim gambar → OCR di server (EC2) → berat untuk verifikasi Bulog.
package ocr

import (
	"bytes"
	"context"
	"image"
	"image/color"
	_ "image/jpeg" // registrasi decoder JPEG
	"image/png"
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
// Strategi: pra-proses (binarisasi + auto-crop + perbesar) lalu coba beberapa PSM;
// bila gagal, fallback ke gambar asli.
func Extract(ctx context.Context, img []byte) (raw string, value float64, err error) {
	// Kandidat gambar: hasil pra-proses dulu (lebih akurat), lalu gambar asli.
	candidates := make([][]byte, 0, 2)
	if pp, ok := preprocess(img); ok {
		candidates = append(candidates, pp)
	}
	candidates = append(candidates, img)

	for _, c := range candidates {
		f, e := os.CreateTemp("", "iot-*.png")
		if e != nil {
			return "", 0, e
		}
		name := f.Name()
		if _, e = f.Write(c); e != nil {
			f.Close()
			os.Remove(name)
			return "", 0, e
		}
		f.Close()

		// Coba beberapa Page Segmentation Mode: 7 (satu baris), 8 (satu kata),
		// 6 (blok), 11 (teks jarang), 13 (baris mentah). Pakai mode pertama
		// yang menghasilkan angka.
		for _, psm := range []string{"7", "8", "6", "11", "13"} {
			cmd := exec.CommandContext(ctx, "tesseract", name, "stdout",
				"--psm", psm, "-c", "tessedit_char_whitelist=0123456789.,")
			out, e := cmd.Output()
			if e != nil {
				err = e
				continue
			}
			raw = strings.TrimSpace(string(out))
			if m := numRe.FindString(raw); m != "" {
				value, _ = strconv.ParseFloat(strings.ReplaceAll(m, ",", "."), 64)
				os.Remove(name)
				return raw, value, nil
			}
		}
		os.Remove(name)
	}
	return raw, 0, err
}

// preprocess — grayscale → ambang Otsu (teks hitam di putih) → buang noise →
// auto-crop ke area angka (+padding) → perbesar agar Tesseract lebih akurat.
// Output PNG (lossless). Mengembalikan ok=false bila gagal/ tak ada teks.
func preprocess(data []byte) ([]byte, bool) {
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, false
	}
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	if w == 0 || h == 0 {
		return nil, false
	}

	// Grayscale + histogram untuk Otsu.
	gray := make([][]uint8, h)
	var hist [256]int
	for y := 0; y < h; y++ {
		gray[y] = make([]uint8, w)
		for x := 0; x < w; x++ {
			c := color.GrayModel.Convert(src.At(b.Min.X+x, b.Min.Y+y)).(color.Gray)
			gray[y][x] = c.Y
			hist[c.Y]++
		}
	}
	thr := otsu(hist, w*h)

	// Proyeksi piksel gelap per kolom/baris untuk menentukan bbox angka.
	// Pakai ambang minimal agar noise (bintik tunggal) tidak melebarkan crop.
	colDark := make([]int, w)
	rowDark := make([]int, h)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			if gray[y][x] < thr {
				colDark[x]++
				rowDark[y]++
			}
		}
	}
	minColHits := max2(2, h/150)
	minRowHits := max2(2, w/150)

	minX, maxX := -1, -1
	for x := 0; x < w; x++ {
		if colDark[x] >= minColHits {
			if minX < 0 {
				minX = x
			}
			maxX = x
		}
	}
	minY, maxY := -1, -1
	for y := 0; y < h; y++ {
		if rowDark[y] >= minRowHits {
			if minY < 0 {
				minY = y
			}
			maxY = y
		}
	}
	if minX < 0 || minY < 0 {
		return nil, false // tak ada area teks yang signifikan
	}

	// Padding proporsional terhadap tinggi teks.
	pad := (maxY-minY)/3 + 6
	minX = clamp(minX-pad, 0, w-1)
	maxX = clamp(maxX+pad, 0, w-1)
	minY = clamp(minY-pad, 0, h-1)
	maxY = clamp(maxY+pad, 0, h-1)
	cw, ch := maxX-minX+1, maxY-minY+1

	// Perbesar (nearest-neighbor) agar tinggi angka ≈160px → akurasi naik.
	scale := 1
	if ch > 0 {
		scale = (160 + ch - 1) / ch
	}
	scale = clamp(scale, 1, 8)

	out := image.NewGray(image.Rect(0, 0, cw*scale, ch*scale))
	for y := 0; y < ch; y++ {
		for x := 0; x < cw; x++ {
			v := uint8(255) // putih = background
			if gray[minY+y][minX+x] < thr {
				v = 0 // hitam = teks
			}
			for dy := 0; dy < scale; dy++ {
				for dx := 0; dx < scale; dx++ {
					out.SetGray(x*scale+dx, y*scale+dy, color.Gray{Y: v})
				}
			}
		}
	}

	var buf bytes.Buffer
	if err := png.Encode(&buf, out); err != nil {
		return nil, false
	}
	return buf.Bytes(), true
}

// otsu — ambang biner optimal dari histogram grayscale (metode Otsu).
func otsu(hist [256]int, total int) uint8 {
	var sum float64
	for i := 0; i < 256; i++ {
		sum += float64(i) * float64(hist[i])
	}
	var sumB, wB, maxVar float64
	thr := 0
	for t := 0; t < 256; t++ {
		wB += float64(hist[t])
		if wB == 0 {
			continue
		}
		wF := float64(total) - wB
		if wF == 0 {
			break
		}
		sumB += float64(t) * float64(hist[t])
		mB := sumB / wB
		mF := (sum - sumB) / wF
		between := wB * wF * (mB - mF) * (mB - mF)
		if between > maxVar {
			maxVar = between
			thr = t
		}
	}
	return uint8(thr)
}

func clamp(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func max2(a, b int) int {
	if a > b {
		return a
	}
	return b
}
