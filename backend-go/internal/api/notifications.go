package api

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"blockagrichain/backend/internal/auth"
	"blockagrichain/backend/internal/models"
)

func (s *Server) listNotifications(w http.ResponseWriter, r *http.Request) {
	p := auth.From(r.Context())
	var list []models.Notification
	s.db.Where("recipient_role = ? AND (recipient_user_id IS NULL OR recipient_user_id = ?)", p.Role, p.UserID).
		Order("id desc").Limit(50).Find(&list)
	s.json(w, 200, list)
}

func (s *Server) markNotificationRead(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	res := s.db.Model(&models.Notification{}).Where("id = ?", id).Update("is_read", true)
	if res.RowsAffected == 0 {
		s.notFound(w, "Notifikasi tidak ditemukan")
		return
	}
	s.json(w, http.StatusNoContent, nil)
}
