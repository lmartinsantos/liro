package hub

import (
	"encoding/json"
	"testing"
	"time"

	"liro/internal/model"
	"liro/internal/store"
)

func setupBoard(t *testing.T) (*store.Store, *Registry, *store.BoardRecord, model.User) {
	t.Helper()
	st, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(st.Close)
	reg := NewRegistry(st)
	t.Cleanup(reg.Close)
	rec, err := st.Create("Room")
	if err != nil {
		t.Fatal(err)
	}
	var user model.User
	rec.WithLock(func() {
		user, _, err = rec.AddUser("Agent")
	})
	if err != nil {
		t.Fatal(err)
	}
	return st, reg, rec, user
}

func TestApplyWithoutRoom(t *testing.T) {
	_, reg, rec, user := setupBoard(t)
	raw, _ := json.Marshal(model.Object{ID: "obj_1", Type: "rect", X: 5, Y: 6, W: 10, H: 8, Fill: "#fff"})
	applied, err := reg.Apply(rec.Meta.ID, user.ID, []model.Op{{Type: "create", Value: raw}})
	if err != nil {
		t.Fatal(err)
	}
	if len(applied) != 1 || applied[0].ObjectID != "obj_1" {
		t.Fatalf("applied: %+v", applied)
	}
	var got model.Object
	rec.WithLock(func() { got = rec.Document.Objects["obj_1"] })
	if got.X != 5 || got.Y != 6 {
		t.Fatalf("persisted: %+v", got)
	}
}

func TestApplyRequiresUser(t *testing.T) {
	_, reg, rec, _ := setupBoard(t)
	raw, _ := json.Marshal(model.Object{ID: "obj_1", Type: "rect", X: 1, Y: 1, W: 4, H: 4})
	if _, err := reg.Apply(rec.Meta.ID, "usr_nope", []model.Op{{Type: "create", Value: raw}}); err == nil {
		t.Fatal("expected unknown user")
	}
	if _, err := reg.Apply(rec.Meta.ID, "", []model.Op{{Type: "create", Value: raw}}); err == nil {
		t.Fatal("expected missing user")
	}
}

func TestApplyBroadcastsToRoom(t *testing.T) {
	_, reg, rec, user := setupBoard(t)
	_, cl, err := reg.Join(rec.Meta.ID, model.Session{UserID: user.ID, SessionID: "ses_test"})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-cl.Send:
	case <-time.After(time.Second):
		t.Fatal("expected state")
	}

	raw, _ := json.Marshal(model.Object{ID: "obj_live", Type: "rect", X: 1, Y: 2, W: 30, H: 20, Fill: "#fff"})
	if _, err := reg.Apply(rec.Meta.ID, user.ID, []model.Op{{Type: "create", Value: raw}}); err != nil {
		t.Fatal(err)
	}

	deadline := time.After(2 * time.Second)
	for {
		select {
		case data := <-cl.Send:
			var env Envelope
			if err := json.Unmarshal(data, &env); err != nil {
				t.Fatal(err)
			}
			if env.Type == "op" && env.Op != nil && env.Op.ObjectID == "obj_live" {
				return
			}
		case <-deadline:
			t.Fatal("expected broadcast op")
		}
	}
}

func TestTouchAgentPresence(t *testing.T) {
	_, reg, rec, user := setupBoard(t)
	if err := reg.TouchAgent(rec.Meta.ID, user); err != nil {
		t.Fatal(err)
	}
	reg.mu.Lock()
	room := reg.rooms[rec.Meta.ID]
	reg.mu.Unlock()
	if room == nil {
		t.Fatal("expected room")
	}
	want := agentSessionID(user.ID)
	room.mu.Lock()
	cl, ok := room.clients[want]
	room.mu.Unlock()
	if !ok || !cl.agent || cl.Session.Name != "Agent" {
		t.Fatalf("agent client: %+v ok=%v", cl, ok)
	}
}
