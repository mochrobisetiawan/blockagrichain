package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"

	"blockagrichain/backend/internal/config"
	"blockagrichain/backend/internal/models"
)

type ctxKey int

const principalKey ctxKey = 0

// Principal — identitas pemanggil hasil decode JWT (≈ CurrentUser di C#).
type Principal struct {
	UserID         int64
	Username       string
	Role           string
	MspID          string
	FabricClientID string
}

type Claims struct {
	Username       string `json:"username"`
	Role           string `json:"role"`
	MspID          string `json:"msp_id"`
	FabricClientID string `json:"fabric_client_id"`
	jwt.RegisteredClaims
}

type Service struct{ cfg *config.Config }

func New(cfg *config.Config) *Service { return &Service{cfg: cfg} }

func HashPassword(pw string) string {
	b, _ := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
	return string(b)
}

func VerifyPassword(hash, pw string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(pw)) == nil
}

func Sha256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

// Issue — terbitkan JWT berisi role, msp_id, fabric_client_id (identitas blockchain).
func (s *Service) Issue(u *models.User) (string, time.Time, error) {
	exp := time.Now().Add(time.Duration(s.cfg.JWTExpiryMinutes) * time.Minute)
	claims := Claims{
		Username:       u.Username,
		Role:           u.Role,
		MspID:          u.MspID,
		FabricClientID: u.FabricClientID,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   strconv.FormatInt(u.ID, 10),
			Issuer:    s.cfg.JWTIssuer,
			Audience:  jwt.ClaimStrings{s.cfg.JWTAudience},
			ExpiresAt: jwt.NewNumericDate(exp),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := tok.SignedString([]byte(s.cfg.JWTKey))
	return signed, exp, err
}

func (s *Service) parse(tokenStr string) (*Principal, error) {
	claims := &Claims{}
	_, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (interface{}, error) {
		return []byte(s.cfg.JWTKey), nil
	}, jwt.WithIssuer(s.cfg.JWTIssuer), jwt.WithAudience(s.cfg.JWTAudience))
	if err != nil {
		return nil, err
	}
	id, _ := strconv.ParseInt(claims.Subject, 10, 64)
	return &Principal{
		UserID: id, Username: claims.Username, Role: claims.Role,
		MspID: claims.MspID, FabricClientID: claims.FabricClientID,
	}, nil
}

// Middleware — wajib JWT valid. Menaruh Principal ke context.
func (s *Service) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := r.Header.Get("Authorization")
		if !strings.HasPrefix(h, "Bearer ") {
			writeErr(w, http.StatusUnauthorized, "Token tidak ada", false)
			return
		}
		p, err := s.parse(strings.TrimPrefix(h, "Bearer "))
		if err != nil {
			writeErr(w, http.StatusUnauthorized, "Token tidak valid", false)
			return
		}
		ctx := context.WithValue(r.Context(), principalKey, p)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// RequireRoles — batasi handler ke role tertentu (≈ [Authorize(Roles=...)]).
func RequireRoles(roles ...string) func(http.Handler) http.Handler {
	allowed := map[string]bool{}
	for _, r := range roles {
		allowed[r] = true
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			p := From(r.Context())
			if p == nil || !allowed[p.Role] {
				writeErr(w, http.StatusForbidden, "Akses ditolak untuk peran Anda", true)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// From — ambil Principal dari context.
func From(ctx context.Context) *Principal {
	if p, ok := ctx.Value(principalKey).(*Principal); ok {
		return p
	}
	return nil
}

func writeErr(w http.ResponseWriter, code int, msg string, denied bool) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": msg, "accessDenied": denied})
}

