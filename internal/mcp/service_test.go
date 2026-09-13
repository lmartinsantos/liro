package liromcp

import (
	"strings"
	"testing"

	"liro/internal/hub"
	"liro/internal/store"
)

func TestInstructionsSkill(t *testing.T) {
	if !strings.Contains(Skill, "name: draw-with-liro") {
		t.Fatalf("skill frontmatter: %s", Skill[:80])
	}
	if !strings.Contains(Skill, "join_board") || !strings.Contains(Skill, "view_board") {
		t.Fatal("skill missing workflow tools")
	}
}

func TestJoinCreateViewAlign(t *testing.T) {
	st, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(st.Close)
	hubs := hub.NewRegistry(st)
	t.Cleanup(hubs.Close)
	svc := NewService(st, hubs)

	meta, err := svc.CreateBoard("Agent room")
	if err != nil {
		t.Fatal(err)
	}
	join, err := svc.JoinBoard(meta.ID, "Cursor", "")
	if err != nil {
		t.Fatal(err)
	}
	if join.UserID == "" || !join.Created {
		t.Fatalf("join: %+v", join)
	}

	again, err := svc.JoinBoard(meta.ID, "Cursor", "")
	if err != nil {
		t.Fatal(err)
	}
	if again.UserID != join.UserID || again.Created {
		t.Fatalf("reuse: %+v", again)
	}

	if _, err := svc.CreateObjects(meta.ID, "", []ObjectSpec{{Type: "rect", X: 80, Y: 80}}); err == nil {
		t.Fatal("expected join-first error")
	}

	created, err := svc.CreateObjects(meta.ID, join.UserID, []ObjectSpec{
		{Type: "rect", X: 80, Y: 80, Text: "A"},
		{Type: "rect", X: 300, Y: 120, W: 80, H: 40, Text: "B"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(created) != 2 {
		t.Fatalf("created: %+v", created)
	}

	view, err := svc.ViewBoard(meta.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	if view.Rev == 0 || len(view.Scene) != 2 {
		t.Fatalf("view: %+v", view)
	}
	if !strings.Contains(view.SVG, created[0].ID) {
		t.Fatalf("svg missing id: %s", view.SVG)
	}

	if err := svc.Align(meta.ID, join.UserID, []string{created[0].ID, created[1].ID}, "top"); err != nil {
		t.Fatal(err)
	}
	read, err := svc.ReadBoard(meta.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	if read.Objects[created[0].ID].Y != read.Objects[created[1].ID].Y {
		t.Fatalf("align top: %+v %+v", read.Objects[created[0].ID], read.Objects[created[1].ID])
	}

	conn, err := svc.ConnectObjects(meta.ID, join.UserID, created[0].ID, created[1].ID, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if conn.Type != "connector" {
		t.Fatalf("connect: %+v", conn)
	}
}

func TestNewServerRegistersTools(t *testing.T) {
	st, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(st.Close)
	hubs := hub.NewRegistry(st)
	t.Cleanup(hubs.Close)
	srv := NewServer(st, hubs)
	if srv == nil {
		t.Fatal("nil server")
	}
}
