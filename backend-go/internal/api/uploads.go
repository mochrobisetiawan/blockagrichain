package api

import "net/http"

// presignUpload — POST /api/uploads/presign
// Body : { "kind": "harvest|delivery|profile", "filename": "...", "contentType": "image/jpeg" }
// Resp : { "uploadUrl": "...", "objectUrl": "...", "key": "...", "method": "PUT", "contentType": "..." }
//
// Klien melakukan PUT file ke uploadUrl dengan header Content-Type yang sama,
// lalu memakai objectUrl sebagai nilai *_photo_url (off-chain, sesuai DPPL).
func (s *Server) presignUpload(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Kind        string `json:"kind"`
		Filename    string `json:"filename"`
		ContentType string `json:"contentType"`
	}
	if err := decode(r, &in); err != nil {
		s.bad(w, "body tidak valid")
		return
	}
	if !s.s3.Enabled() {
		s.json(w, http.StatusServiceUnavailable, map[string]any{
			"error":   "Object storage S3 belum dikonfigurasi (set S3_BUCKET). Sementara, kirim URL foto manual.",
			"s3Ready": false,
		})
		return
	}
	ct := in.ContentType
	if ct == "" {
		ct = "application/octet-stream"
	}
	uploadURL, objectURL, key, err := s.s3.PresignPut(r.Context(), in.Kind, in.Filename, ct)
	if err != nil {
		s.fail(w, err)
		return
	}
	s.json(w, http.StatusOK, map[string]any{
		"uploadUrl":   uploadURL,
		"objectUrl":   objectURL,
		"key":         key,
		"method":      "PUT",
		"contentType": ct,
		"s3Ready":     true,
	})
}
