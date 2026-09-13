package api

import (
	"bytes"
	"encoding/json"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/coder/websocket"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"liro/internal/auth"
	"liro/internal/hub"
	liromcp "liro/internal/mcp"
	"liro/internal/model"
	"liro/internal/store"
)

type Server struct {
	Store  *store.Store
	Hubs   *hub.Registry
	Tokens *auth.Tokens
}

func New(st *store.Store, hubs *hub.Registry, static fs.FS) http.Handler {
	s := &Server{
		Store:  st,
		Hubs:   hubs,
		Tokens: auth.NewTokens(""),
	}
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowOriginFunc: func(_ *http.Request, origin string) bool {
			return strings.HasPrefix(origin, "http://localhost:") ||
				strings.HasPrefix(origin, "http://127.0.0.1:")
		},
		AllowedMethods:   []string{"GET", "POST", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"*"},
		AllowCredentials: false,
	}))

	r.Route("/api", func(r chi.Router) {
		r.Get("/boards", s.listBoards)
		r.Post("/boards", s.createBoard)
		r.Post("/boards/import", s.importBoard)
		r.Get("/boards/{id}", s.getBoard)
		r.Get("/boards/{id}/document", s.getDocument)
		r.Delete("/boards/{id}", s.deleteBoard)
		r.Post("/boards/{id}/unlock", s.unlockBoard)
		r.Post("/boards/{id}/password", s.setPassword)
		r.Post("/boards/{id}/archive", s.archiveBoard)
		r.Post("/boards/{id}/restore", s.restoreBoard)
		r.Get("/boards/{id}/export", s.exportBoard)
		r.Get("/boards/{id}/users", s.listUsers)
		r.Post("/boards/{id}/users", s.addUser)
		r.Get("/boards/{id}/snapshots", s.listSnapshots)
		r.Post("/boards/{id}/snapshots", s.createSnapshot)
		r.Post("/boards/{id}/snapshots/{ts}/restore", s.restoreSnapshot)
		r.Post("/boards/{id}/assets", s.uploadAsset)
		r.Get("/boards/{id}/assets/{name}", s.getAsset)
	})
	r.Get("/ws/boards/{id}", s.wsBoard)

	mcpHandler := liromcp.Handler(st, hubs)
	r.Handle("/mcp", mcpHandler)
	r.Handle("/mcp/", mcpHandler)

	if static != nil {
		r.Handle("/*", spaHandler(static))
	}
	return r
}

func (s *Server) listBoards(w http.ResponseWriter, r *http.Request) {
	archived := r.URL.Query().Get("archived") == "1" || r.URL.Query().Get("archived") == "true"
	list, err := s.Store.List(archived)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]model.PublicMeta, 0, len(list))
	for _, m := range list {
		out = append(out, m.Public())
	}
	writeJSON(w, out)
}

func (s *Server) createBoard(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	rec, err := s.Store.Create(body.Name)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	var meta model.Meta
	rec.WithLock(func() { meta = rec.Meta })
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, meta.Public())
}

func (s *Server) getBoard(w http.ResponseWriter, r *http.Request) {
	rec, err := s.Store.Get(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusNotFound, "board not found")
		return
	}
	var meta model.Meta
	rec.WithLock(func() { meta = rec.Meta })
	if meta.HasPassword() && !s.unlocked(r, meta.ID) {
		writeJSON(w, meta.Limited())
		return
	}
	writeJSON(w, meta.Public())
}

// getDocument returns the live board document for read-only viewing / embeds.
// Password-protected boards require a valid unlock token (header or ?unlock=).
func (s *Server) getDocument(w http.ResponseWriter, r *http.Request) {
	rec, err := s.Store.Get(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusNotFound, "board not found")
		return
	}
	var meta model.Meta
	var doc model.Document
	rec.WithLock(func() {
		meta = rec.Meta
		doc = rec.Document
	})
	if meta.HasPassword() && !s.unlocked(r, meta.ID) {
		writeErr(w, http.StatusUnauthorized, "password required")
		return
	}
	writeJSON(w, map[string]any{
		"meta":     meta.Public(),
		"document": doc,
	})
}

func (s *Server) unlockBoard(w http.ResponseWriter, r *http.Request) {
	boardID := chi.URLParam(r, "id")
	rec, err := s.Store.Get(boardID)
	if err != nil {
		writeErr(w, http.StatusNotFound, "board not found")
		return
	}
	var body struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	var hash string
	rec.WithLock(func() { hash = rec.Meta.PasswordHash })
	if hash == "" {
		token, exp, err := s.Tokens.Issue(boardID)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, map[string]any{"token": token, "expiresAt": exp.UTC().Format(time.RFC3339)})
		return
	}
	if err := auth.CheckPassword(hash, body.Password); err != nil {
		writeErr(w, http.StatusUnauthorized, "incorrect password")
		return
	}
	token, exp, err := s.Tokens.Issue(boardID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, map[string]any{"token": token, "expiresAt": exp.UTC().Format(time.RFC3339)})
}

func (s *Server) setPassword(w http.ResponseWriter, r *http.Request) {
	boardID := chi.URLParam(r, "id")
	rec, err := s.Store.Get(boardID)
	if err != nil {
		writeErr(w, http.StatusNotFound, "board not found")
		return
	}
	var body struct {
		Password    string `json:"password"`
		NewPassword string `json:"newPassword"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	var meta model.Meta
	rec.WithLock(func() { meta = rec.Meta })
	if err := s.authorizeManage(r, meta, body.Password); err != nil {
		writeAuthErr(w, err)
		return
	}
	newPass := strings.TrimSpace(body.NewPassword)
	var hash string
	if newPass != "" {
		h, err := auth.HashPassword(newPass)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		hash = h
	}
	rec, err = s.Store.SetPassword(boardID, hash)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	rec.WithLock(func() { meta = rec.Meta })
	writeJSON(w, meta.Public())
}

func (s *Server) archiveBoard(w http.ResponseWriter, r *http.Request) {
	s.mutateBoard(w, r, func(id, password string) (*store.BoardRecord, error) {
		rec, err := s.Store.Get(id)
		if err != nil {
			return nil, err
		}
		var meta model.Meta
		rec.WithLock(func() { meta = rec.Meta })
		if err := s.authorizeManage(r, meta, password); err != nil {
			return nil, err
		}
		return s.Store.Archive(id)
	})
}

func (s *Server) restoreBoard(w http.ResponseWriter, r *http.Request) {
	s.mutateBoard(w, r, func(id, password string) (*store.BoardRecord, error) {
		rec, err := s.Store.Get(id)
		if err != nil {
			return nil, err
		}
		var meta model.Meta
		rec.WithLock(func() { meta = rec.Meta })
		if err := s.authorizeManage(r, meta, password); err != nil {
			return nil, err
		}
		return s.Store.Restore(id)
	})
}

func (s *Server) mutateBoard(w http.ResponseWriter, r *http.Request, fn func(id, password string) (*store.BoardRecord, error)) {
	boardID := chi.URLParam(r, "id")
	var body struct {
		Password string `json:"password"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	rec, err := fn(boardID, body.Password)
	if err != nil {
		writeAuthErr(w, err)
		return
	}
	var meta model.Meta
	rec.WithLock(func() { meta = rec.Meta })
	writeJSON(w, meta.Public())
}

func (s *Server) deleteBoard(w http.ResponseWriter, r *http.Request) {
	boardID := chi.URLParam(r, "id")
	rec, err := s.Store.Get(boardID)
	if err != nil {
		writeErr(w, http.StatusNotFound, "board not found")
		return
	}
	var body struct {
		Password string `json:"password"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	password := body.Password
	if password == "" {
		password = r.Header.Get("X-Board-Password")
	}
	var meta model.Meta
	rec.WithLock(func() { meta = rec.Meta })
	if err := s.authorizeManage(r, meta, password); err != nil {
		writeAuthErr(w, err)
		return
	}
	s.Hubs.Drop(boardID)
	if err := s.Store.Delete(boardID); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) exportBoard(w http.ResponseWriter, r *http.Request) {
	boardID := chi.URLParam(r, "id")
	rec, err := s.Store.Get(boardID)
	if err != nil {
		writeErr(w, http.StatusNotFound, "board not found")
		return
	}
	var meta model.Meta
	rec.WithLock(func() { meta = rec.Meta })
	password := r.URL.Query().Get("password")
	if password == "" {
		password = r.Header.Get("X-Board-Password")
	}
	if err := s.authorizeManage(r, meta, password); err != nil {
		writeAuthErr(w, err)
		return
	}
	filename := sanitizeFilename(meta.Name) + ".liro.zip"
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	if err := s.Store.Export(boardID, w); err != nil {
		log.Println("export:", err)
	}
}

func (s *Server) importBoard(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 64<<20)
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		writeErr(w, http.StatusBadRequest, "file too large or invalid")
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "file required")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, 64<<20))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "could not read file")
		return
	}
	rec, err := s.Store.Import(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	var meta model.Meta
	rec.WithLock(func() { meta = rec.Meta })
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, meta.Public())
}

func (s *Server) listUsers(w http.ResponseWriter, r *http.Request) {
	rec, err := s.Store.Get(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusNotFound, "board not found")
		return
	}
	var meta model.Meta
	rec.WithLock(func() { meta = rec.Meta })
	if meta.HasPassword() && !s.unlocked(r, meta.ID) {
		writeErr(w, http.StatusUnauthorized, "password required")
		return
	}
	writeJSON(w, meta.Users)
}

func (s *Server) addUser(w http.ResponseWriter, r *http.Request) {
	boardID := chi.URLParam(r, "id")
	rec, err := s.Store.Get(boardID)
	if err != nil {
		writeErr(w, http.StatusNotFound, "board not found")
		return
	}
	var body struct {
		Name     string `json:"name"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	var meta model.Meta
	rec.WithLock(func() { meta = rec.Meta })
	if meta.IsArchived() {
		writeErr(w, http.StatusForbidden, "board is archived")
		return
	}
	if meta.HasPassword() && !s.unlocked(r, boardID) {
		if err := auth.CheckPassword(meta.PasswordHash, body.Password); err != nil {
			writeErr(w, http.StatusUnauthorized, "password required")
			return
		}
	}
	var (
		user    model.User
		created bool
		addErr  error
	)
	rec.WithLock(func() {
		user, created, addErr = rec.AddUser(body.Name)
	})
	if addErr != nil {
		writeErr(w, http.StatusBadRequest, addErr.Error())
		return
	}
	if created {
		w.WriteHeader(http.StatusCreated)
	}
	writeJSON(w, user)
}

const maxAssetBytes = 12 << 20

func (s *Server) uploadAsset(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxAssetBytes+1<<20)
	boardID := chi.URLParam(r, "id")
	rec, err := s.Store.Get(boardID)
	if err != nil {
		writeErr(w, http.StatusNotFound, "board not found")
		return
	}
	var meta model.Meta
	rec.WithLock(func() { meta = rec.Meta })
	if meta.IsArchived() {
		writeErr(w, http.StatusForbidden, "board is archived")
		return
	}
	if meta.HasPassword() && !s.unlocked(r, boardID) {
		writeErr(w, http.StatusUnauthorized, "password required")
		return
	}
	if err := r.ParseMultipartForm(maxAssetBytes); err != nil {
		writeErr(w, http.StatusBadRequest, "file too large or invalid")
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "file required")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxAssetBytes+1))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "could not read file")
		return
	}
	if len(data) == 0 || len(data) > maxAssetBytes {
		writeErr(w, http.StatusBadRequest, "file too large")
		return
	}
	ext, mime, ok := sniffImage(data)
	if !ok {
		writeErr(w, http.StatusBadRequest, "unsupported image type")
		return
	}
	var name string
	var saveErr error
	rec.WithLock(func() {
		name, saveErr = rec.SaveAsset(ext, data)
	})
	if saveErr != nil {
		writeErr(w, http.StatusInternalServerError, saveErr.Error())
		return
	}
	writeJSON(w, map[string]string{
		"name": name,
		"src":  "/api/boards/" + boardID + "/assets/" + name,
		"type": mime,
	})
}

func (s *Server) getAsset(w http.ResponseWriter, r *http.Request) {
	rec, err := s.Store.Get(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusNotFound, "board not found")
		return
	}
	var path string
	var pathErr error
	rec.WithLock(func() {
		path, pathErr = rec.AssetPath(chi.URLParam(r, "name"))
	})
	if pathErr != nil {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	if _, err := os.Stat(path); err != nil {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	http.ServeFile(w, r, path)
}

func sniffImage(data []byte) (ext, mime string, ok bool) {
	mime = http.DetectContentType(data)
	switch mime {
	case "image/png":
		return "png", mime, true
	case "image/jpeg":
		return "jpg", mime, true
	case "image/gif":
		return "gif", mime, true
	case "image/webp":
		return "webp", mime, true
	default:
		return "", mime, false
	}
}

func (s *Server) listSnapshots(w http.ResponseWriter, r *http.Request) {
	list, err := s.Store.ListSnapshots(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusNotFound, "board not found")
		return
	}
	writeJSON(w, list)
}

func (s *Server) createSnapshot(w http.ResponseWriter, r *http.Request) {
	boardID := chi.URLParam(r, "id")
	rec, err := s.Store.Get(boardID)
	if err != nil {
		writeErr(w, http.StatusNotFound, "board not found")
		return
	}
	var meta model.Meta
	rec.WithLock(func() { meta = rec.Meta })
	var body struct {
		Password string `json:"password"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if err := s.authorizeManage(r, meta, body.Password); err != nil {
		writeAuthErr(w, err)
		return
	}
	info, err := s.Store.ForceSnapshot(boardID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, info)
}

func (s *Server) restoreSnapshot(w http.ResponseWriter, r *http.Request) {
	boardID := chi.URLParam(r, "id")
	tsStr := chi.URLParam(r, "ts")
	ts, err := strconv.ParseInt(tsStr, 10, 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid snapshot timestamp")
		return
	}
	rec, err := s.Store.Get(boardID)
	if err != nil {
		writeErr(w, http.StatusNotFound, "board not found")
		return
	}
	var meta model.Meta
	rec.WithLock(func() { meta = rec.Meta })
	var body struct {
		Password string `json:"password"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if err := s.authorizeManage(r, meta, body.Password); err != nil {
		writeAuthErr(w, err)
		return
	}
	if err := s.Store.RestoreSnapshot(boardID, ts); err != nil {
		if strings.Contains(err.Error(), "not found") {
			writeErr(w, http.StatusNotFound, err.Error())
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.Hubs.BroadcastState(boardID)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) wsBoard(w http.ResponseWriter, r *http.Request) {
	boardID := chi.URLParam(r, "id")
	userID := r.URL.Query().Get("userId")
	sessionID := r.URL.Query().Get("sessionId")
	if userID == "" {
		writeErr(w, http.StatusBadRequest, "userId required")
		return
	}

	rec, err := s.Store.Get(boardID)
	if err != nil {
		writeErr(w, http.StatusNotFound, "board not found")
		return
	}
	var meta model.Meta
	rec.WithLock(func() { meta = rec.Meta })
	if meta.IsArchived() {
		writeErr(w, http.StatusForbidden, "board is archived")
		return
	}
	if meta.HasPassword() {
		token := r.URL.Query().Get("unlock")
		if token == "" {
			token = r.Header.Get("X-Board-Unlock")
		}
		if err := s.Tokens.Verify(boardID, token); err != nil {
			writeErr(w, http.StatusUnauthorized, "password required")
			return
		}
	}

	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: []string{"localhost:*", "127.0.0.1:*"},
	})
	if err != nil {
		log.Println("ws accept:", err)
		return
	}

	room, client, err := s.Hubs.Join(boardID, model.Session{
		SessionID: sessionID,
		UserID:    userID,
	})
	if err != nil {
		_ = c.Close(websocket.StatusPolicyViolation, err.Error())
		return
	}
	defer func() {
		s.Hubs.Leave(boardID, client.ID)
		_ = c.Close(websocket.StatusNormalClosure, "")
	}()

	ctx := r.Context()
	go func() {
		for data := range client.Send {
			wctx := ctx
			if err := c.Write(wctx, websocket.MessageText, data); err != nil {
				return
			}
		}
	}()

	for {
		_, data, err := c.Read(ctx)
		if err != nil {
			return
		}
		var env hub.Envelope
		if err := json.Unmarshal(data, &env); err != nil {
			continue
		}
		room.Submit(client, env)
	}
}

func (s *Server) unlocked(r *http.Request, boardID string) bool {
	token := r.Header.Get("X-Board-Unlock")
	if token == "" {
		token = r.URL.Query().Get("unlock")
	}
	return s.Tokens.Verify(boardID, token) == nil
}

// authorizeManage allows the action if the board has no password, or if the
// request carries a valid unlock token or the correct password.
func (s *Server) authorizeManage(r *http.Request, meta model.Meta, password string) error {
	if !meta.HasPassword() {
		return nil
	}
	if s.unlocked(r, meta.ID) {
		return nil
	}
	if password == "" {
		password = r.Header.Get("X-Board-Password")
	}
	return auth.CheckPassword(meta.PasswordHash, password)
}

func writeAuthErr(w http.ResponseWriter, err error) {
	if err == nil {
		return
	}
	msg := err.Error()
	switch {
	case err == auth.ErrBadPassword || err == auth.ErrBadToken ||
		msg == "incorrect password" || msg == "password required":
		writeErr(w, http.StatusUnauthorized, "incorrect password")
	case msg == "board not found":
		writeErr(w, http.StatusNotFound, msg)
	default:
		if strings.Contains(msg, "required") || strings.Contains(msg, "too long") {
			writeErr(w, http.StatusBadRequest, msg)
			return
		}
		writeErr(w, http.StatusBadRequest, msg)
	}
}

func sanitizeFilename(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return "board"
	}
	var b strings.Builder
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_':
			b.WriteRune(r)
		case r == ' ':
			b.WriteByte('-')
		}
	}
	out := b.String()
	if out == "" {
		return "board"
	}
	if len(out) > 60 {
		out = out[:60]
	}
	return out
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func spaHandler(fsys fs.FS) http.Handler {
	fileServer := http.FileServer(http.FS(fsys))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api") || strings.HasPrefix(r.URL.Path, "/ws") || strings.HasPrefix(r.URL.Path, "/mcp") {
			http.NotFound(w, r)
			return
		}
		name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if name == "" || name == "." {
			name = "index.html"
		}
		if f, err := fsys.Open(name); err == nil {
			info, statErr := f.Stat()
			_ = f.Close()
			if statErr == nil && !info.IsDir() {
				fileServer.ServeHTTP(w, r)
				return
			}
		}
		index, err := fs.ReadFile(fsys, "index.html")
		if err != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(index)
	})
}
