package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"liro/internal/hub"
	"liro/internal/model"
	"liro/internal/store"
)

func TestBoardJoinAndOp(t *testing.T) {
	dir := t.TempDir()
	st, err := store.New(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(st.Close)
	hubs := hub.NewRegistry(st)
	t.Cleanup(hubs.Close)
	srv := httptest.NewServer(New(st, hubs, nil))
	t.Cleanup(srv.Close)

	res, err := http.Post(srv.URL+"/api/boards", "application/json", strings.NewReader(`{"name":"Room"}`))
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create status %d", res.StatusCode)
	}
	var meta model.Meta
	if err := json.NewDecoder(res.Body).Decode(&meta); err != nil {
		t.Fatal(err)
	}
	_ = res.Body.Close()

	res, err = http.Post(srv.URL+"/api/boards/"+meta.ID+"/users", "application/json", strings.NewReader(`{"name":"Luis"}`))
	if err != nil {
		t.Fatal(err)
	}
	var user model.User
	if err := json.NewDecoder(res.Body).Decode(&user); err != nil {
		t.Fatal(err)
	}
	_ = res.Body.Close()
	if user.Name != "Luis" || user.Color == "" {
		t.Fatalf("user: %+v", user)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/boards/" + meta.ID + "?userId=" + user.ID
	conn, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "")

	env := readType(t, ctx, conn, "state")
	if env.Document == nil {
		t.Fatalf("expected state document, got %+v", env)
	}

	raw, _ := json.Marshal(model.Object{ID: "obj_1", Type: "rect", X: 1, Y: 2, W: 30, H: 20, Fill: "#fff"})
	if err := wsjson.Write(ctx, conn, hub.Envelope{
		Type: "op",
		Op:   &model.Op{ID: "op_1", Type: "create", Value: raw, ActorID: user.ID},
	}); err != nil {
		t.Fatal(err)
	}
	env = readType(t, ctx, conn, "op")
	if env.Op == nil || env.Op.ObjectID != "obj_1" {
		t.Fatalf("expected create echo, got %+v", env)
	}

	if err := wsjson.Write(ctx, conn, hub.Envelope{Type: "chat", Text: "hello board"}); err != nil {
		t.Fatal(err)
	}
	env = readType(t, ctx, conn, "chat")
	if env.Message == nil || env.Message.Text != "hello board" {
		t.Fatalf("expected chat, got %+v", env)
	}

	res, err = http.Get(srv.URL + "/api/boards/" + meta.ID + "/snapshots")
	if err != nil {
		t.Fatal(err)
	}
	var snaps []model.SnapshotInfo
	if err := json.NewDecoder(res.Body).Decode(&snaps); err != nil {
		t.Fatal(err)
	}
	_ = res.Body.Close()
}

var tinyPNG = []byte{
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
	0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
	0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
	0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
	0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
	0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
}

func TestUploadAndGetAsset(t *testing.T) {
	dir := t.TempDir()
	st, err := store.New(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(st.Close)
	hubs := hub.NewRegistry(st)
	t.Cleanup(hubs.Close)
	srv := httptest.NewServer(New(st, hubs, nil))
	t.Cleanup(srv.Close)

	res, err := http.Post(srv.URL+"/api/boards", "application/json", strings.NewReader(`{"name":"Pics"}`))
	if err != nil {
		t.Fatal(err)
	}
	var meta model.Meta
	if err := json.NewDecoder(res.Body).Decode(&meta); err != nil {
		t.Fatal(err)
	}
	_ = res.Body.Close()

	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, err := mw.CreateFormFile("file", "shot.png")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fw.Write(tinyPNG); err != nil {
		t.Fatal(err)
	}
	if err := mw.Close(); err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest(http.MethodPost, srv.URL+"/api/boards/"+meta.ID+"/assets", &body)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	res, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusOK {
		t.Fatalf("upload status %d", res.StatusCode)
	}
	var uploaded struct {
		Name string `json:"name"`
		Src  string `json:"src"`
	}
	if err := json.NewDecoder(res.Body).Decode(&uploaded); err != nil {
		t.Fatal(err)
	}
	_ = res.Body.Close()
	if uploaded.Name == "" || !strings.HasPrefix(uploaded.Src, "/api/boards/") {
		t.Fatalf("uploaded: %+v", uploaded)
	}

	res, err = http.Get(srv.URL + uploaded.Src)
	if err != nil {
		t.Fatal(err)
	}
	got, err := io.ReadAll(res.Body)
	_ = res.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusOK || len(got) != len(tinyPNG) {
		t.Fatalf("get status %d size %d", res.StatusCode, len(got))
	}

	res, err = http.Get(srv.URL + "/api/boards/" + meta.ID + "/assets/../meta.json")
	if err != nil {
		t.Fatal(err)
	}
	_ = res.Body.Close()
	if res.StatusCode == http.StatusOK {
		t.Fatal("expected traversal reject")
	}

	var text bytes.Buffer
	tw := multipart.NewWriter(&text)
	tf, _ := tw.CreateFormFile("file", "note.txt")
	_, _ = tf.Write([]byte("hello"))
	_ = tw.Close()
	req, _ = http.NewRequest(http.MethodPost, srv.URL+"/api/boards/"+meta.ID+"/assets", &text)
	req.Header.Set("Content-Type", tw.FormDataContentType())
	res, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected reject text, got %d", res.StatusCode)
	}
}

func TestGetDocument(t *testing.T) {
	dir := t.TempDir()
	st, err := store.New(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(st.Close)
	hubs := hub.NewRegistry(st)
	t.Cleanup(hubs.Close)
	srv := httptest.NewServer(New(st, hubs, nil))
	t.Cleanup(srv.Close)

	res, err := http.Post(srv.URL+"/api/boards", "application/json", strings.NewReader(`{"name":"View"}`))
	if err != nil {
		t.Fatal(err)
	}
	var meta model.Meta
	if err := json.NewDecoder(res.Body).Decode(&meta); err != nil {
		t.Fatal(err)
	}
	_ = res.Body.Close()

	rec, err := st.Get(meta.ID)
	if err != nil {
		t.Fatal(err)
	}
	rec.WithLock(func() {
		rec.Document.Objects["obj_1"] = model.Object{ID: "obj_1", Type: "rect", X: 10, Y: 20, W: 40, H: 30}
		rec.Document.Rev = 1
		rec.MarkDirty(store.FileBoard)
	})

	res, err = http.Get(srv.URL + "/api/boards/" + meta.ID + "/document")
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusOK {
		t.Fatalf("document status %d", res.StatusCode)
	}
	var out struct {
		Meta     model.Meta     `json:"meta"`
		Document model.Document `json:"document"`
	}
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	_ = res.Body.Close()
	if out.Meta.Name != "View" || out.Document.Objects["obj_1"].Type != "rect" {
		t.Fatalf("unexpected document payload: %+v", out)
	}

	body, _ := json.Marshal(map[string]string{"password": "", "newPassword": "secret"})
	req, err := http.NewRequest(http.MethodPost, srv.URL+"/api/boards/"+meta.ID+"/password", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	res, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("set password status %d", res.StatusCode)
	}

	res, err = http.Get(srv.URL + "/api/boards/" + meta.ID + "/document")
	if err != nil {
		t.Fatal(err)
	}
	_ = res.Body.Close()
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected unauthorized without unlock, got %d", res.StatusCode)
	}

	res, err = http.Post(srv.URL+"/api/boards/"+meta.ID+"/unlock", "application/json", strings.NewReader(`{"password":"secret"}`))
	if err != nil {
		t.Fatal(err)
	}
	var unlock struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(res.Body).Decode(&unlock); err != nil {
		t.Fatal(err)
	}
	_ = res.Body.Close()

	req, err = http.NewRequest(http.MethodGet, srv.URL+"/api/boards/"+meta.ID+"/document", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("X-Board-Unlock", unlock.Token)
	res, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusOK {
		t.Fatalf("document with unlock status %d", res.StatusCode)
	}
	_ = res.Body.Close()
}

func TestMCPInitialize(t *testing.T) {
	dir := t.TempDir()
	st, err := store.New(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(st.Close)
	hubs := hub.NewRegistry(st)
	t.Cleanup(hubs.Close)
	srv := httptest.NewServer(New(st, hubs, nil))
	t.Cleanup(srv.Close)

	body := `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}`
	req, err := http.NewRequest(http.MethodPost, srv.URL+"/mcp", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	got, err := io.ReadAll(res.Body)
	_ = res.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status %d body %s", res.StatusCode, got)
	}
	if !strings.Contains(string(got), `"name":"liro"`) {
		t.Fatalf("expected liro server info, got %s", got)
	}
	if !strings.Contains(string(got), "instructions") {
		t.Fatalf("expected server instructions, got %s", got)
	}
}

func readType(t *testing.T, ctx context.Context, conn *websocket.Conn, want string) hub.Envelope {
	t.Helper()
	for {
		var env hub.Envelope
		if err := wsjson.Read(ctx, conn, &env); err != nil {
			t.Fatalf("read %s: %v", want, err)
		}
		if env.Type == want {
			return env
		}
	}
}
