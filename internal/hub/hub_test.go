package hub

import (
	"encoding/json"
	"testing"
	"time"

	"liro/internal/model"
)

func nextEnvelope(t *testing.T, cl *Client, want string) Envelope {
	t.Helper()
	deadline := time.After(2 * time.Second)
	for {
		select {
		case data, ok := <-cl.Send:
			if !ok {
				t.Fatalf("send channel closed waiting for %q", want)
			}
			var env Envelope
			if err := json.Unmarshal(data, &env); err != nil {
				t.Fatal(err)
			}
			if env.Type == want {
				return env
			}
		case <-deadline:
			t.Fatalf("timed out waiting for %q", want)
		}
	}
}

func roomOf(t *testing.T, reg *Registry, boardID string) *Room {
	t.Helper()
	reg.mu.Lock()
	defer reg.mu.Unlock()
	room := reg.rooms[boardID]
	if room == nil {
		t.Fatal("expected room")
	}
	return room
}

func TestRejoinSameSessionKeepsReplacement(t *testing.T) {
	_, reg, rec, user := setupBoard(t)
	boardID := rec.Meta.ID
	_, stale, err := reg.Join(boardID, model.Session{UserID: user.ID, SessionID: "ses_same"})
	if err != nil {
		t.Fatal(err)
	}
	room, fresh, err := reg.Join(boardID, model.Session{UserID: user.ID, SessionID: "ses_same"})
	if err != nil {
		t.Fatal(err)
	}
	for range stale.Send {
	}

	reg.Leave(boardID, stale)

	room.mu.Lock()
	got := room.clients["ses_same"]
	room.mu.Unlock()
	if got != fresh {
		t.Fatal("stale leave removed the replacement client")
	}
	nextEnvelope(t, fresh, "state")
	raw, _ := json.Marshal(model.Object{ID: "obj_1", Type: "rect", W: 10, H: 10})
	if _, err := reg.Apply(boardID, user.ID, []model.Op{{Type: "create", Value: raw}}); err != nil {
		t.Fatal(err)
	}
	nextEnvelope(t, fresh, "op")
}

func TestDuplicateOpIsAckedNotReapplied(t *testing.T) {
	_, reg, rec, user := setupBoard(t)
	room, cl, err := reg.Join(rec.Meta.ID, model.Session{UserID: user.ID, SessionID: "ses_dup"})
	if err != nil {
		t.Fatal(err)
	}
	nextEnvelope(t, cl, "state")

	raw, _ := json.Marshal(model.Object{ID: "obj_1", Type: "rect", W: 10, H: 10})
	op := model.Op{ID: "op_dup", Type: "create", Value: raw}
	room.Submit(cl, Envelope{Type: "op", Op: &op})
	first := nextEnvelope(t, cl, "op")

	var rev uint64
	rec.WithLock(func() { rev = rec.Document.Rev })

	room.Submit(cl, Envelope{Type: "op", Op: &op})
	ack := nextEnvelope(t, cl, "op")
	if ack.Op == nil || ack.Op.ID != "op_dup" {
		t.Fatalf("expected ack, got %+v", ack)
	}
	var after uint64
	rec.WithLock(func() { after = rec.Document.Rev })
	if after != rev || first.Op.Seq != rev {
		t.Fatalf("op applied twice: rev %d -> %d", rev, after)
	}
}

func TestRejectedOpCarriesOp(t *testing.T) {
	_, reg, rec, user := setupBoard(t)
	room, cl, err := reg.Join(rec.Meta.ID, model.Session{UserID: user.ID, SessionID: "ses_err"})
	if err != nil {
		t.Fatal(err)
	}
	nextEnvelope(t, cl, "state")
	room.Submit(cl, Envelope{Type: "op", Op: &model.Op{ID: "op_bad", Type: "delete", ObjectID: "obj_missing"}})
	env := nextEnvelope(t, cl, "error")
	if env.Op == nil || env.Op.ID != "op_bad" {
		t.Fatalf("expected rejected op in error, got %+v", env)
	}
}

func TestPingPong(t *testing.T) {
	_, reg, rec, user := setupBoard(t)
	room, cl, err := reg.Join(rec.Meta.ID, model.Session{UserID: user.ID, SessionID: "ses_ping"})
	if err != nil {
		t.Fatal(err)
	}
	nextEnvelope(t, cl, "state")
	room.Submit(cl, Envelope{Type: "ping"})
	nextEnvelope(t, cl, "pong")
}

func TestSlowClientIsKicked(t *testing.T) {
	prev := SendBuffer
	SendBuffer = 4
	t.Cleanup(func() { SendBuffer = prev })

	_, reg, rec, user := setupBoard(t)
	boardID := rec.Meta.ID
	_, slow, err := reg.Join(boardID, model.Session{UserID: user.ID, SessionID: "ses_slow"})
	if err != nil {
		t.Fatal(err)
	}
	ops := make([]model.Op, 0, 8)
	for i := 0; i < 8; i++ {
		raw, _ := json.Marshal(model.Object{ID: "obj_" + string(rune('a'+i)), Type: "rect", W: 10, H: 10})
		ops = append(ops, model.Op{Type: "create", Value: raw})
	}
	if _, err := reg.Apply(boardID, user.ID, ops); err != nil {
		t.Fatal(err)
	}

	room := roomOf(t, reg, boardID)
	room.mu.Lock()
	closed := slow.closed
	room.mu.Unlock()
	if !closed {
		t.Fatal("expected slow client to be kicked")
	}
	for range slow.Send {
	}
	reg.Leave(boardID, slow)
	room.mu.Lock()
	_, still := room.clients["ses_slow"]
	room.mu.Unlock()
	if still {
		t.Fatal("kicked client should be removed on leave")
	}
}
