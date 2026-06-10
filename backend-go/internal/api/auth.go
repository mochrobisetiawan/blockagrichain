package api

import (
	"net/http"

	"blockagrichain/backend/internal/auth"
	"blockagrichain/backend/internal/models"
)

func userInfo(u *models.User) map[string]any {
	return map[string]any{
		"id": u.ID, "username": u.Username, "email": u.Email,
		"role": u.Role, "mspId": u.MspID, "fabricClientId": u.FabricClientID,
	}
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var req struct{ Username, Password string }
	if err := decode(r, &req); err != nil {
		s.bad(w, "Body tidak valid")
		return
	}
	var u models.User
	if err := s.db.Where("username = ?", req.Username).First(&u).Error; err != nil {
		s.json(w, http.StatusUnauthorized, map[string]any{"error": "Username atau password salah"})
		return
	}
	if !auth.VerifyPassword(u.PasswordHash, req.Password) {
		s.json(w, http.StatusUnauthorized, map[string]any{"error": "Username atau password salah"})
		return
	}
	if !u.IsActive {
		var f models.Farmer
		if s.db.Where("user_id = ? AND reg_status = ?", u.ID, "PENDING").First(&f).Error == nil {
			s.json(w, http.StatusUnauthorized, map[string]any{"error": "Akun menunggu persetujuan Kementan"})
			return
		}
		s.json(w, http.StatusUnauthorized, map[string]any{"error": "Akun dinonaktifkan"})
		return
	}
	token, exp, err := s.auth.Issue(&u)
	if err != nil {
		s.fail(w, err)
		return
	}
	s.json(w, http.StatusOK, map[string]any{
		"token": token, "expiresAt": exp, "user": userInfo(&u),
	})
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	p := auth.From(r.Context())
	var u models.User
	if err := s.db.First(&u, p.UserID).Error; err != nil {
		s.notFound(w, "User tidak ditemukan")
		return
	}
	s.json(w, http.StatusOK, userInfo(&u))
}
