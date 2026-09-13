package model

import (
	"encoding/json"
	"testing"
)

func TestApplyCreateUpdateDelete(t *testing.T) {
	d := NewDocument()
	raw, _ := json.Marshal(Object{
		ID: "obj_1", Type: "rect", X: 10, Y: 20, W: 40, H: 30, Z: "a0", Fill: "#fff",
	})
	op := Op{ID: "op1", Type: "create", Value: raw}
	if err := d.Apply(&op); err != nil {
		t.Fatal(err)
	}
	if d.Rev != 1 || d.Objects["obj_1"].X != 10 {
		t.Fatalf("create: %+v", d)
	}

	v, _ := json.Marshal(99.0)
	up := Op{ID: "op2", Type: "update", ObjectID: "obj_1", Path: "x", Value: v}
	if err := d.Apply(&up); err != nil {
		t.Fatal(err)
	}
	if d.Objects["obj_1"].X != 99 || up.Seq != 2 {
		t.Fatalf("update: %+v", d.Objects["obj_1"])
	}

	del := Op{ID: "op3", Type: "delete", ObjectID: "obj_1"}
	if err := d.Apply(&del); err != nil {
		t.Fatal(err)
	}
	if _, ok := d.Objects["obj_1"]; ok {
		t.Fatal("expected delete")
	}
}

func TestCascadeDeleteKeepsContainerChildren(t *testing.T) {
	d := NewDocument()
	frame, _ := json.Marshal(Object{ID: "f1", Type: "frame", X: 0, Y: 0, W: 200, H: 200})
	child, _ := json.Marshal(Object{ID: "c1", Type: "rect", ParentID: "f1", X: 10, Y: 10, W: 20, H: 20})
	conn, _ := json.Marshal(Object{ID: "n1", Type: "connector", FromID: "c1", ToID: "f1", FromSide: "right", ToSide: "left"})
	for _, raw := range [][]byte{frame, child, conn} {
		op := Op{Type: "create", Value: raw}
		if err := d.Apply(&op); err != nil {
			t.Fatal(err)
		}
	}
	if err := d.Apply(&Op{Type: "delete", ObjectID: "f1"}); err != nil {
		t.Fatal(err)
	}
	if _, ok := d.Objects["f1"]; ok {
		t.Fatal("frame should be gone")
	}
	c1, ok := d.Objects["c1"]
	if !ok || c1.ParentID != "" {
		t.Fatalf("child should remain unparented: %+v", c1)
	}
	if _, ok := d.Objects["n1"]; ok {
		t.Fatal("connector to deleted frame should be removed")
	}
}

func TestApplySrcPath(t *testing.T) {
	d := NewDocument()
	raw, _ := json.Marshal(Object{ID: "img_1", Type: "image", X: 0, Y: 0, W: 40, H: 30, Src: "/api/boards/b/assets/a.png"})
	if err := d.Apply(&Op{Type: "create", Value: raw}); err != nil {
		t.Fatal(err)
	}
	if d.Objects["img_1"].Src == "" {
		t.Fatal("expected src on create")
	}
	v, _ := json.Marshal("/api/boards/b/assets/b.png")
	if err := d.Apply(&Op{Type: "update", ObjectID: "img_1", Path: "src", Value: v}); err != nil {
		t.Fatal(err)
	}
	if d.Objects["img_1"].Src != "/api/boards/b/assets/b.png" {
		t.Fatalf("src: %s", d.Objects["img_1"].Src)
	}
}

func TestApplyTextStylePaths(t *testing.T) {
	d := NewDocument()
	raw, _ := json.Marshal(Object{ID: "t1", Type: "postit", X: 0, Y: 0, W: 120, H: 80})
	if err := d.Apply(&Op{Type: "create", Value: raw}); err != nil {
		t.Fatal(err)
	}
	family, _ := json.Marshal("Georgia, serif")
	if err := d.Apply(&Op{Type: "update", ObjectID: "t1", Path: "fontFamily", Value: family}); err != nil {
		t.Fatal(err)
	}
	size, _ := json.Marshal(22.0)
	if err := d.Apply(&Op{Type: "update", ObjectID: "t1", Path: "fontSize", Value: size}); err != nil {
		t.Fatal(err)
	}
	on, _ := json.Marshal(true)
	if err := d.Apply(&Op{Type: "update", ObjectID: "t1", Path: "bold", Value: on}); err != nil {
		t.Fatal(err)
	}
	if err := d.Apply(&Op{Type: "update", ObjectID: "t1", Path: "italic", Value: on}); err != nil {
		t.Fatal(err)
	}
	align, _ := json.Marshal("center")
	if err := d.Apply(&Op{Type: "update", ObjectID: "t1", Path: "textAlign", Value: align}); err != nil {
		t.Fatal(err)
	}
	got := d.Objects["t1"]
	if got.FontFamily == "" || got.FontSize != 22 || !got.Bold || !got.Italic || got.TextAlign != "center" {
		t.Fatalf("style: %+v", got)
	}
}

func TestNextUserColorBalances(t *testing.T) {
	users := []User{{Color: UserColors[0]}, {Color: UserColors[0]}}
	got := NextUserColor(users)
	if got == UserColors[0] && len(UserColors) > 1 {
		t.Fatalf("expected unused color, got %s", got)
	}
}
