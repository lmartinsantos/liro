package store

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"liro/internal/id"
	"liro/internal/model"
)

type FileKind string

const (
	FileMeta  FileKind = "meta"
	FileBoard FileKind = "board"
	FileChat  FileKind = "chat"
)

const (
	IdleSnapshot = 1 * time.Minute
	MaxSnapshot  = 10 * time.Minute
	TickEvery    = 2 * time.Second
)

type fileState struct {
	dirty        bool
	lastWrite    time.Time
	lastSnapshot time.Time
}

type BoardRecord struct {
	mu       sync.Mutex
	dir      string
	Meta     model.Meta
	Document model.Document
	Chat     model.ChatLog
	files    map[FileKind]*fileState
}

type Store struct {
	root   string
	mu     sync.Mutex
	loaded map[string]*BoardRecord
	stop   chan struct{}
	done   chan struct{}
}

func New(root string) (*Store, error) {
	boards := filepath.Join(root, "boards")
	if err := os.MkdirAll(boards, 0o755); err != nil {
		return nil, err
	}
	s := &Store{
		root:   root,
		loaded: map[string]*BoardRecord{},
		stop:   make(chan struct{}),
		done:   make(chan struct{}),
	}
	go s.loop()
	return s, nil
}

func (s *Store) Close() {
	close(s.stop)
	<-s.done
	s.FlushAll()
}

func (s *Store) loop() {
	defer close(s.done)
	t := time.NewTicker(TickEvery)
	defer t.Stop()
	for {
		select {
		case <-s.stop:
			return
		case now := <-t.C:
			s.snapshotDue(now)
		}
	}
}

func (s *Store) snapshotDue(now time.Time) {
	s.mu.Lock()
	recs := make([]*BoardRecord, 0, len(s.loaded))
	for _, r := range s.loaded {
		recs = append(recs, r)
	}
	s.mu.Unlock()
	for _, r := range recs {
		r.maybeSnapshot(now, false)
	}
}

func (s *Store) FlushAll() {
	s.mu.Lock()
	recs := make([]*BoardRecord, 0, len(s.loaded))
	for _, r := range s.loaded {
		recs = append(recs, r)
	}
	s.mu.Unlock()
	for _, r := range recs {
		r.maybeSnapshot(time.Now(), true)
	}
}

func (s *Store) Unload(boardID string) {
	s.mu.Lock()
	rec, ok := s.loaded[boardID]
	if ok {
		delete(s.loaded, boardID)
	}
	s.mu.Unlock()
	if ok {
		rec.maybeSnapshot(time.Now(), true)
	}
}

// List returns boards filtered by archive state. archived=false is the default home list.
func (s *Store) List(archived bool) ([]model.Meta, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	entries, err := os.ReadDir(filepath.Join(s.root, "boards"))
	if err != nil {
		return nil, err
	}
	out := []model.Meta{}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		id := e.Name()
		var meta model.Meta
		if rec, ok := s.loaded[id]; ok {
			rec.mu.Lock()
			meta = rec.Meta
			rec.mu.Unlock()
		} else {
			m, err := readJSON[model.Meta](filepath.Join(s.root, "boards", id, "meta.json"))
			if err != nil {
				continue
			}
			meta = m
		}
		if meta.IsArchived() != archived {
			continue
		}
		out = append(out, meta)
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].CreatedAt.After(out[j].CreatedAt)
	})
	return out, nil
}

func (s *Store) Create(name string) (*BoardRecord, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, fmt.Errorf("name required")
	}
	rec := &BoardRecord{
		dir: filepath.Join(s.root, "boards", ""),
		Meta: model.Meta{
			ID:        id.New("brd"),
			Name:      name,
			CreatedAt: time.Now().UTC(),
			Users:     []model.User{},
		},
		Document: model.NewDocument(),
		Chat:     model.NewChatLog(),
		files:    newFileStates(time.Now()),
	}
	rec.dir = filepath.Join(s.root, "boards", rec.Meta.ID)
	if err := os.MkdirAll(filepath.Join(rec.dir, "snapshots"), 0o755); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Join(rec.dir, "assets"), 0o755); err != nil {
		return nil, err
	}
	if err := rec.writeWorking(); err != nil {
		return nil, err
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

func (s *Store) Get(boardID string) (*BoardRecord, error) {
	s.mu.Lock()
	if rec, ok := s.loaded[boardID]; ok {
		s.mu.Unlock()
		return rec, nil
	}
	s.mu.Unlock()

	dir := filepath.Join(s.root, "boards", boardID)
	meta, err := readJSON[model.Meta](filepath.Join(dir, "meta.json"))
	if err != nil {
		return nil, fmt.Errorf("board not found")
	}
	doc, err := readJSON[model.Document](filepath.Join(dir, "board.json"))
	if err != nil {
		doc = model.NewDocument()
	}
	if doc.Objects == nil {
		doc.Objects = map[string]model.Object{}
	}
	chat, err := readJSON[model.ChatLog](filepath.Join(dir, "chat.json"))
	if err != nil {
		chat = model.NewChatLog()
	}
	if chat.Messages == nil {
		chat.Messages = []model.ChatMessage{}
	}
	now := time.Now()
	rec := &BoardRecord{
		dir:      dir,
		Meta:     meta,
		Document: doc,
		Chat:     chat,
		files:    newFileStates(now),
	}

	s.mu.Lock()
	if existing, ok := s.loaded[boardID]; ok {
		s.mu.Unlock()
		return existing, nil
	}
	s.loaded[boardID] = rec
	s.mu.Unlock()
	return rec, nil
}

func (s *Store) ListSnapshots(boardID string) ([]model.SnapshotInfo, error) {
	rec, err := s.Get(boardID)
	if err != nil {
		return nil, err
	}
	dir := filepath.Join(rec.dir, "snapshots")
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return []model.SnapshotInfo{}, nil
		}
		return nil, err
	}
	grouped := map[int64]map[string]bool{}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		parts := strings.SplitN(name, "__", 2)
		if len(parts) != 2 {
			continue
		}
		ts, err := strconv.ParseInt(parts[0], 10, 64)
		if err != nil {
			continue
		}
		kind := strings.TrimSuffix(parts[1], ".json")
		if grouped[ts] == nil {
			grouped[ts] = map[string]bool{}
		}
		grouped[ts][kind] = true
	}
	out := make([]model.SnapshotInfo, 0, len(grouped))
	for ts, files := range grouped {
		info := model.SnapshotInfo{Timestamp: ts}
		for k := range files {
			info.Files = append(info.Files, k)
		}
		sort.Strings(info.Files)
		out = append(out, info)
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].Timestamp > out[j].Timestamp
	})
	return out, nil
}

// ForceSnapshot writes a snapshot of meta, board, and chat immediately.
func (s *Store) ForceSnapshot(boardID string) (model.SnapshotInfo, error) {
	rec, err := s.Get(boardID)
	if err != nil {
		return model.SnapshotInfo{}, err
	}
	rec.mu.Lock()
	defer rec.mu.Unlock()
	now := time.Now()
	kinds := []FileKind{FileMeta, FileBoard, FileChat}
	if err := rec.snapshotLocked(now, kinds); err != nil {
		return model.SnapshotInfo{}, err
	}
	return model.SnapshotInfo{
		Timestamp: now.UnixMilli(),
		Files:     []string{string(FileMeta), string(FileBoard), string(FileChat)},
	}, nil
}

// RestoreSnapshot replaces the live board (and chat if present) from a snapshot.
// Current state is snapshotted first so the restore is reversible.
func (s *Store) RestoreSnapshot(boardID string, ts int64) error {
	rec, err := s.Get(boardID)
	if err != nil {
		return err
	}
	boardPath := filepath.Join(rec.dir, "snapshots", fmt.Sprintf("%d__%s.json", ts, FileBoard))
	if _, err := os.Stat(boardPath); err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("snapshot not found")
		}
		return err
	}
	doc, err := readJSON[model.Document](boardPath)
	if err != nil {
		return err
	}
	var chat *model.ChatLog
	chatPath := filepath.Join(rec.dir, "snapshots", fmt.Sprintf("%d__%s.json", ts, FileChat))
	if data, err := readJSON[model.ChatLog](chatPath); err == nil {
		chat = &data
	}

	rec.mu.Lock()
	defer rec.mu.Unlock()
	now := time.Now()
	if err := rec.snapshotLocked(now, []FileKind{FileMeta, FileBoard, FileChat}); err != nil {
		return err
	}
	rec.Document = doc
	if chat != nil {
		rec.Chat = *chat
	}
	rec.MarkDirty(FileBoard)
	rec.MarkDirty(FileChat)
	return rec.writeWorking()
}

func newFileStates(now time.Time) map[FileKind]*fileState {
	return map[FileKind]*fileState{
		FileMeta:  {lastSnapshot: now, lastWrite: now},
		FileBoard: {lastSnapshot: now, lastWrite: now},
		FileChat:  {lastSnapshot: now, lastWrite: now},
	}
}

func (r *BoardRecord) WithLock(fn func()) {
	r.mu.Lock()
	defer r.mu.Unlock()
	fn()
}

func (r *BoardRecord) MarkDirty(kind FileKind) {
	st := r.files[kind]
	st.dirty = true
	st.lastWrite = time.Now()
}

func (r *BoardRecord) AddUser(name string) (model.User, bool, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return model.User{}, false, fmt.Errorf("name required")
	}
	if existing := model.FindUserByName(r.Meta.Users, name); existing != nil {
		return *existing, false, nil
	}
	u := model.User{
		ID:    id.New("usr"),
		Name:  name,
		Color: model.NextUserColor(r.Meta.Users),
	}
	r.Meta.Users = append(r.Meta.Users, u)
	r.MarkDirty(FileMeta)
	return u, true, nil
}

func (r *BoardRecord) maybeSnapshot(now time.Time, force bool) {
	r.mu.Lock()
	defer r.mu.Unlock()

	kinds := []FileKind{}
	for _, kind := range []FileKind{FileMeta, FileBoard, FileChat} {
		st := r.files[kind]
		if !st.dirty {
			continue
		}
		idleReady := now.Sub(st.lastWrite) >= IdleSnapshot
		maxReady := now.Sub(st.lastSnapshot) >= MaxSnapshot
		if force || idleReady || maxReady {
			kinds = append(kinds, kind)
		}
	}
	if len(kinds) == 0 {
		return
	}
	_ = r.snapshotLocked(now, kinds)
}

func (r *BoardRecord) snapshotLocked(now time.Time, kinds []FileKind) error {
	if err := os.MkdirAll(filepath.Join(r.dir, "snapshots"), 0o755); err != nil {
		return err
	}
	ts := now.UnixMilli()
	for _, kind := range kinds {
		if err := r.writeKind(kind); err != nil {
			return err
		}
		src := r.kindPath(kind)
		dst := filepath.Join(r.dir, "snapshots", fmt.Sprintf("%d__%s.json", ts, kind))
		data, err := os.ReadFile(src)
		if err != nil {
			return err
		}
		if err := os.WriteFile(dst, data, 0o644); err != nil {
			return err
		}
		st := r.files[kind]
		st.dirty = false
		st.lastSnapshot = now
	}
	return nil
}

func (r *BoardRecord) writeWorking() error {
	if err := os.MkdirAll(filepath.Join(r.dir, "snapshots"), 0o755); err != nil {
		return err
	}
	for _, kind := range []FileKind{FileMeta, FileBoard, FileChat} {
		if err := r.writeKind(kind); err != nil {
			return err
		}
	}
	return nil
}

func (r *BoardRecord) kindPath(kind FileKind) string {
	return filepath.Join(r.dir, string(kind)+".json")
}

func (r *BoardRecord) writeKind(kind FileKind) error {
	var v any
	switch kind {
	case FileMeta:
		v = r.Meta
	case FileBoard:
		v = r.Document
	case FileChat:
		v = r.Chat
	default:
		return fmt.Errorf("unknown kind %s", kind)
	}
	return writeJSON(r.kindPath(kind), v)
}

func readJSON[T any](path string) (T, error) {
	var zero T
	data, err := os.ReadFile(path)
	if err != nil {
		return zero, err
	}
	if err := json.Unmarshal(data, &zero); err != nil {
		return zero, err
	}
	return zero, nil
}

var assetNameRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]*\.(png|jpg|jpeg|gif|webp)$`)

var allowedAssetExt = map[string]bool{
	"png": true, "jpg": true, "jpeg": true, "gif": true, "webp": true,
}

func ValidAssetName(name string) bool {
	if name == "" || name != filepath.Base(name) {
		return false
	}
	return assetNameRe.MatchString(name)
}

func (r *BoardRecord) SaveAsset(ext string, data []byte) (string, error) {
	ext = strings.ToLower(strings.TrimPrefix(ext, "."))
	if ext == "jpeg" {
		ext = "jpg"
	}
	if !allowedAssetExt[ext] {
		return "", fmt.Errorf("unsupported image type")
	}
	name := id.New("img") + "." + ext
	dir := filepath.Join(r.dir, "assets")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	path := filepath.Join(dir, name)
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return "", err
	}
	if err := os.Rename(tmp, path); err != nil {
		return "", err
	}
	return name, nil
}

func (r *BoardRecord) AssetPath(name string) (string, error) {
	if !ValidAssetName(name) {
		return "", fmt.Errorf("invalid asset")
	}
	root := filepath.Join(r.dir, "assets")
	path := filepath.Clean(filepath.Join(root, name))
	sep := string(os.PathSeparator)
	if path != root && !strings.HasPrefix(path, root+sep) {
		return "", fmt.Errorf("invalid asset")
	}
	return path, nil
}

func writeJSON(path string, v any) error {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
