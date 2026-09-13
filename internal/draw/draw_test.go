package draw

import (
	"strings"
	"testing"

	"liro/internal/model"
)

func TestBuildDefaults(t *testing.T) {
	obj, err := Build(Spec{Type: "rect", X: 10, Y: 20}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if obj.ID == "" || obj.W != 160 || obj.H != 100 || obj.Fill != DefaultFill || obj.Stroke != DefaultStroke {
		t.Fatalf("rect: %+v", obj)
	}
	note, err := Build(Spec{Type: "postit", X: 0, Y: 0, Text: "hi"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if note.Fill != PostitFill || note.Stroke != PostitStroke || note.W != 180 {
		t.Fatalf("postit: %+v", note)
	}
	txt, err := Build(Spec{Type: "text", X: 1, Y: 2, Text: "Hello"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if txt.FontSize != DefaultFontSize || txt.Fill != TextFill || txt.W != 240 {
		t.Fatalf("text: %+v", txt)
	}
	sticker, err := Build(Spec{Type: "sticker", X: 5, Y: 6}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if sticker.W != 64 || sticker.H != 64 || sticker.Text != "🔥" {
		t.Fatalf("sticker: %+v", sticker)
	}
}

func TestPolygonPoints(t *testing.T) {
	tri, err := Build(Spec{Type: "triangle", X: 0, Y: 0, W: 10, H: 10}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(tri.Points) < 6 {
		t.Fatalf("triangle points: %+v", tri.Points)
	}
	hex, err := Build(Spec{Type: "hexagon", X: 0, Y: 0, W: 100, H: 80}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(hex.Points) < 12 {
		t.Fatalf("hexagon points: %+v", hex.Points)
	}
	cyl, err := Build(Spec{Type: "cylinder", X: 0, Y: 0, W: 80, H: 100}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if cyl.W != 80 || cyl.H != 100 {
		t.Fatalf("cylinder size: %+v", cyl)
	}
	rr, err := Build(Spec{Type: "roundrect", X: 0, Y: 0, W: 100, H: 80}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if rr.CornerRadius <= 0 {
		t.Fatalf("roundrect cornerRadius: %+v", rr)
	}
	want := TrianglePoints(10, 10)
	if len(tri.Points) != len(want) || tri.Points[0] != want[0] || tri.Points[1] != want[1] {
		t.Fatalf("triangle points: %+v", tri.Points)
	}
	arr := ArrowPoints(100, 50)
	if len(arr) != 14 || arr[6] != 100 || arr[7] != 25 {
		t.Fatalf("arrow: %+v", arr)
	}
}

func TestNearestSides(t *testing.T) {
	left := model.Object{ID: "l", Type: "rect", X: 0, Y: 0, W: 40, H: 40}
	right := model.Object{ID: "r", Type: "rect", X: 200, Y: 0, W: 40, H: 40}
	fs, ts := NearestSides(left, right)
	if fs != SideRight || ts != SideLeft {
		t.Fatalf("sides %s -> %s", fs, ts)
	}
	conn, err := Connect(left, right, "", "", map[string]model.Object{left.ID: left, right.ID: right})
	if err != nil {
		t.Fatal(err)
	}
	if conn.Type != "connector" || conn.FromID != "l" || conn.ToID != "r" || conn.FromSide != "right" || conn.ToSide != "left" {
		t.Fatalf("connect: %+v", conn)
	}
}

func TestSceneAndSVG(t *testing.T) {
	a, _ := Build(Spec{Type: "rect", X: 80, Y: 80, W: 100, H: 60, Text: "A"}, nil)
	objs := map[string]model.Object{a.ID: a}
	b, _ := Build(Spec{Type: "ellipse", X: 300, Y: 80, W: 80, H: 80}, objs)
	objs[b.ID] = b
	scene := Scene(objs)
	if len(scene) != 2 {
		t.Fatalf("scene: %+v", scene)
	}
	svg := SVG(objs)
	if !strings.Contains(svg, a.ID) || !strings.Contains(svg, b.ID) {
		t.Fatalf("svg missing ids: %s", svg)
	}
	if !strings.Contains(svg, "<rect") || !strings.Contains(svg, "<ellipse") {
		t.Fatalf("svg shapes: %s", svg)
	}
}

func TestUnknownType(t *testing.T) {
	if _, err := Build(Spec{Type: "blob"}, nil); err == nil {
		t.Fatal("expected error")
	}
}

func TestAABBLine(t *testing.T) {
	o := model.Object{Type: "line", X: 10, Y: 20, Points: []float64{0, 0, 50, 10}}
	b := AABB(o)
	if b.X != 10 || b.Y != 20 || b.W != 50 || b.H != 10 {
		t.Fatalf("aabb: %+v", b)
	}
}
