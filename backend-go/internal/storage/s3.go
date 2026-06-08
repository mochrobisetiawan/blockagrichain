// Package storage — integrasi object storage S3 (off-chain) sesuai DPPL:
// file biner (foto bukti panen/serah terima, foto profil) disimpan di S3,
// hanya URL-nya yang masuk SQL Server dan hanya SHA-256 yang masuk ledger.
//
// Pola: presigned PUT URL — klien mengunggah file LANGSUNG ke S3 (backend
// tidak menyalurkan biner besar). Kompatibel AWS S3 & MinIO (path-style).
package storage

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type S3 struct {
	bucket    string
	region    string
	endpoint  string // override (mis. MinIO http://minio:9000); kosong = AWS
	publicURL string // override base URL publik object; kosong = bentuk standar AWS

	once    sync.Once
	client  *s3.Client
	presign *s3.PresignClient
	initErr error
}

// New — buat handle (lazy; koneksi AWS dibuat saat pertama dipakai).
func New(bucket, region, endpoint, publicURL string) *S3 {
	return &S3{bucket: bucket, region: region, endpoint: strings.TrimRight(endpoint, "/"), publicURL: strings.TrimRight(publicURL, "/")}
}

// Enabled — apakah S3 dikonfigurasi (bucket di-set).
func (s *S3) Enabled() bool { return s != nil && s.bucket != "" }

func (s *S3) init(ctx context.Context) error {
	s.once.Do(func() {
		cfg, err := awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(s.region))
		if err != nil {
			s.initErr = err
			return
		}
		cl := s3.NewFromConfig(cfg, func(o *s3.Options) {
			if s.endpoint != "" {
				o.BaseEndpoint = aws.String(s.endpoint)
				o.UsePathStyle = true // MinIO / endpoint kustom
			}
		})
		s.client = cl
		s.presign = s3.NewPresignClient(cl)
	})
	return s.initErr
}

// Put — unggah byte langsung dari server (mis. gambar dari ESP32 yang masuk ke
// backend). Mengembalikan URL object. Jika S3 tak dikonfigurasi, kembalikan
// placeholder agar alur tetap jalan (file sebenarnya disimpan saat S3 aktif).
func (s *S3) Put(ctx context.Context, kind, filename, contentType string, data []byte) (objectURL, key string, err error) {
	key = objectKey(kind, filename)
	if !s.Enabled() {
		return "local://" + key, key, nil // placeholder bila S3 belum diaktifkan
	}
	if err = s.init(ctx); err != nil {
		return "", "", fmt.Errorf("inisialisasi S3 gagal: %w", err)
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	_, err = s.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(s.bucket),
		Key:         aws.String(key),
		Body:        bytes.NewReader(data),
		ContentType: aws.String(contentType),
	})
	if err != nil {
		return "", "", err
	}
	return s.objectURL(key), key, nil
}

// objectKey — kind/<tanggal>/<random>.<ext> (mis. harvest/2026-06-05/ab12cd34.jpg).
func objectKey(kind, filename string) string {
	kind = sanitize(kind)
	if kind == "" {
		kind = "misc"
	}
	ext := strings.ToLower(path.Ext(filename))
	if ext == "" {
		ext = ".bin"
	}
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return fmt.Sprintf("%s/%s/%s%s", kind, time.Now().UTC().Format("2006-01-02"), hex.EncodeToString(b), ext)
}

func sanitize(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	out := make([]rune, 0, len(s))
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			out = append(out, r)
		}
	}
	return string(out)
}

// objectURL — URL publik object setelah diunggah.
func (s *S3) objectURL(key string) string {
	switch {
	case s.publicURL != "":
		return s.publicURL + "/" + key
	case s.endpoint != "":
		return s.endpoint + "/" + s.bucket + "/" + key
	default:
		return fmt.Sprintf("https://%s.s3.%s.amazonaws.com/%s", s.bucket, s.region, key)
	}
}

// PresignPut — hasilkan URL PUT bertanda-tangan + URL object final.
// Klien wajib mengunggah dengan header Content-Type yang sama persis.
func (s *S3) PresignPut(ctx context.Context, kind, filename, contentType string) (uploadURL, objectURL, key string, err error) {
	if !s.Enabled() {
		return "", "", "", fmt.Errorf("S3 belum dikonfigurasi: set S3_BUCKET (off-chain object storage)")
	}
	if err = s.init(ctx); err != nil {
		return "", "", "", fmt.Errorf("inisialisasi S3 gagal: %w", err)
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	key = objectKey(kind, filename)
	req, err := s.presign.PresignPutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(s.bucket),
		Key:         aws.String(key),
		ContentType: aws.String(contentType),
	}, s3.WithPresignExpires(15*time.Minute))
	if err != nil {
		return "", "", "", err
	}
	return req.URL, s.objectURL(key), key, nil
}
