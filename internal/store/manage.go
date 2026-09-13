package store

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"liro/internal/auth"
	"liro/internal/id"
	"liro/internal/model"
)

func (s *Store) Archive(boardID string) (*BoardRecord, error) {
	rec, err := s.Get(boardID)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	rec.WithLock(func() {
		if rec.Meta.ArchivedAt == nil {
			rec.Meta.ArchivedAt = &now
			rec.MarkDirty(FileMeta)
		}
	})
	rec.maybeSnapshot(time.Now(), true)
	return rec, nil
}

func (s *Store) Restore(boardID string) (*BoardRecord, error) {
	rec, err := s.Get(boardID)
	if err != nil {
		return nil, err
	}
	rec.WithLock(func() {
		if rec.Meta.ArchivedAt != nil {
			rec.Meta.ArchivedAt = nil
			rec.MarkDirty(FileMeta)
		}
	})
	rec.maybeSnapshot(time.Now(), true)
	return rec, nil
}

func (s *Store) SetPassword(boardID, hash string) (*BoardRecord, error) {
	rec, err := s.Get(boardID)
	if err != nil {
		return nil, err
	}
	rec.WithLock(func() {
		rec.Meta.PasswordHash = hash
		rec.MarkDirty(FileMeta)
	})
	rec.maybeSnapshot(time.Now(), true)
	return rec, nil
}

// Delete permanently removes the board directory. Caller should drop the hub room first.
func (s *Store) Delete(boardID string) error {
	if boardID == "" || boardID != filepath.Base(boardID) || strings.Contains(boardID, "..") {
		return fmt.Errorf("invalid board id")
	}
	s.Unload(boardID)
	dir := filepath.Join(s.root, "boards", boardID)
	if _, err := os.Stat(dir); err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("board not found")
		}
		return err
	}
	return os.RemoveAll(dir)
}

func (s *Store) Export(boardID string, w io.Writer) error {
	rec, err := s.Get(boardID)
	if err != nil {
		return err
	}
	rec.maybeSnapshot(time.Now(), true)

	zw := zip.NewWriter(w)
	defer zw.Close()

	addFile := func(name, path string) error {
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		fw, err := zw.Create(name)
		if err != nil {
			return err
		}
		_, err = fw.Write(data)
		return err
	}

	var dir string
	rec.WithLock(func() { dir = rec.dir })

	for _, name := range []string{"meta.json", "board.json", "chat.json"} {
		if err := addFile(name, filepath.Join(dir, name)); err != nil {
			return err
		}
	}

	assetsDir := filepath.Join(dir, "assets")
	entries, err := os.ReadDir(assetsDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if !ValidAssetName(name) {
			continue
		}
		if err := addFile(filepath.Join("assets", name), filepath.Join(assetsDir, name)); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) Import(r io.ReaderAt, size int64) (*BoardRecord, error) {
	zr, err := zip.NewReader(r, size)
	if err != nil {
		return nil, fmt.Errorf("invalid zip: %w", err)
	}

	files := map[string][]byte{}
	for _, f := range zr.File {
		name := filepath.Clean(f.Name)
		if strings.HasPrefix(name, "..") || filepath.IsAbs(name) {
			return nil, fmt.Errorf("invalid zip entry")
		}
		// Normalize to forward slashes for map keys
		name = filepath.ToSlash(name)
		if f.FileInfo().IsDir() {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return nil, err
		}
		data, err := io.ReadAll(io.LimitReader(rc, 32<<20))
		rc.Close()
		if err != nil {
			return nil, err
		}
		files[name] = data
	}

	metaData, ok := files["meta.json"]
	if !ok {
		return nil, fmt.Errorf("meta.json missing from archive")
	}
	boardData, ok := files["board.json"]
	if !ok {
		return nil, fmt.Errorf("board.json missing from archive")
	}
	chatData := files["chat.json"]

	var meta model.Meta
	if err := json.Unmarshal(metaData, &meta); err != nil {
		return nil, fmt.Errorf("invalid meta.json")
	}
	var doc model.Document
	if err := json.Unmarshal(boardData, &doc); err != nil {
		return nil, fmt.Errorf("invalid board.json")
	}
	if doc.Objects == nil {
		doc.Objects = map[string]model.Object{}
	}
	var chat model.ChatLog
	if len(chatData) > 0 {
		if err := json.Unmarshal(chatData, &chat); err != nil {
			return nil, fmt.Errorf("invalid chat.json")
		}
	}
	if chat.Messages == nil {
		chat = model.NewChatLog()
	}

	newID := id.New("brd")
	meta.ID = newID
	meta.ArchivedAt = nil
	if meta.Name == "" {
		meta.Name = "Imported board"
	}
	if meta.CreatedAt.IsZero() {
		meta.CreatedAt = time.Now().UTC()
	}
	if meta.Users == nil {
		meta.Users = []model.User{}
	}
	// Keep PasswordHash if present so restored boards stay protected.

	rec := &BoardRecord{
		dir:      filepath.Join(s.root, "boards", newID),
		Meta:     meta,
		Document: doc,
		Chat:     chat,
		files:    newFileStates(time.Now()),
	}
	if err := os.MkdirAll(filepath.Join(rec.dir, "snapshots"), 0o755); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Join(rec.dir, "assets"), 0o755); err != nil {
		return nil, err
	}
	if err := rec.writeWorking(); err != nil {
		_ = os.RemoveAll(rec.dir)
		return nil, err
	}

	for name, data := range files {
		if !strings.HasPrefix(name, "assets/") {
			continue
		}
		base := filepath.Base(name)
		if !ValidAssetName(base) {
			continue
		}
		path := filepath.Join(rec.dir, "assets", base)
		if err := os.WriteFile(path, data, 0o644); err != nil {
			_ = os.RemoveAll(rec.dir)
			return nil, err
		}
	}

	now := time.Now()
	for _, st := range rec.files {
		st.dirty = false
		st.lastSnapshot = now
		st.lastWrite = now
	}

	s.mu.Lock()
	s.loaded[rec.Meta.ID] = rec
	s.mu.Unlock()
	return rec, nil
}

// VerifyBoardPassword checks the plaintext password against the board hash.
func (s *Store) VerifyBoardPassword(boardID, password string) error {
	rec, err := s.Get(boardID)
	if err != nil {
		return err
	}
	var hash string
	rec.WithLock(func() { hash = rec.Meta.PasswordHash })
	return auth.CheckPassword(hash, password)
}

// ExportBytes is a convenience for tests / callers that need a buffer.
func (s *Store) ExportBytes(boardID string) ([]byte, error) {
	var buf bytes.Buffer
	if err := s.Export(boardID, &buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
