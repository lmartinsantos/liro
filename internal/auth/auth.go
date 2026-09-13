package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"os"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
)

const (
	TokenTTL      = 24 * time.Hour
	bcryptCost    = bcrypt.DefaultCost
	tokenVersion  = 1
)

var (
	ErrBadPassword = errors.New("incorrect password")
	ErrBadToken    = errors.New("invalid or expired unlock token")
)

func HashPassword(password string) (string, error) {
	password = strings.TrimSpace(password)
	if password == "" {
		return "", errors.New("password required")
	}
	if len(password) > 200 {
		return "", errors.New("password too long")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcryptCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

func CheckPassword(hash, password string) error {
	if hash == "" {
		return nil
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)); err != nil {
		return ErrBadPassword
	}
	return nil
}

type Tokens struct {
	mu     sync.Mutex
	secret []byte
}

func NewTokens(secret string) *Tokens {
	t := &Tokens{}
	if secret != "" {
		t.secret = []byte(secret)
		return t
	}
	if env := os.Getenv("LIRO_SECRET"); env != "" {
		t.secret = []byte(env)
		return t
	}
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		panic("auth: generate secret: " + err.Error())
	}
	t.secret = buf
	return t
}

func (t *Tokens) Issue(boardID string) (token string, expiresAt time.Time, err error) {
	expiresAt = time.Now().UTC().Add(TokenTTL)
	payload := make([]byte, 1+8+len(boardID))
	payload[0] = tokenVersion
	binary.BigEndian.PutUint64(payload[1:9], uint64(expiresAt.Unix()))
	copy(payload[9:], boardID)

	mac := hmac.New(sha256.New, t.secretBytes())
	_, _ = mac.Write(payload)
	sig := mac.Sum(nil)

	raw := append(payload, sig...)
	token = base64.RawURLEncoding.EncodeToString(raw)
	return token, expiresAt, nil
}

func (t *Tokens) Verify(boardID, token string) error {
	if token == "" {
		return ErrBadToken
	}
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil || len(raw) < 1+8+1+sha256.Size {
		return ErrBadToken
	}
	sig := raw[len(raw)-sha256.Size:]
	payload := raw[:len(raw)-sha256.Size]
	if payload[0] != tokenVersion {
		return ErrBadToken
	}
	exp := int64(binary.BigEndian.Uint64(payload[1:9]))
	id := string(payload[9:])
	if id != boardID {
		return ErrBadToken
	}
	if time.Now().UTC().Unix() > exp {
		return ErrBadToken
	}
	mac := hmac.New(sha256.New, t.secretBytes())
	_, _ = mac.Write(payload)
	if !hmac.Equal(sig, mac.Sum(nil)) {
		return ErrBadToken
	}
	return nil
}

func (t *Tokens) secretBytes() []byte {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.secret
}
