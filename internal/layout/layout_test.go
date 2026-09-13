package layout

import (
	"testing"

	"liro/internal/model"
)

func boxes() map[string]model.Object {
	return map[string]model.Object{
		"a": {ID: "a", Type: "rect", X: 10, Y: 20, W: 40, H: 20, Z: "a0"},
		"b": {ID: "b", Type: "rect", X: 80, Y: 50, W: 20, H: 40, Z: "a1"},
		"c": {ID: "c", Type: "rect", X: 200, Y: 10, W: 30, H: 10, Z: "a2"},
		"n": {ID: "n", Type: "connector", X: 0, Y: 0, W: 1, H: 1, FromID: "a", ToID: "b", Z: "a3"},
	}
}

func TestAlignLeft(t *testing.T) {
	objs := boxes()
	p := AlignPatches(AlignLeft, []string{"a", "b"}, objs)
	if len(p) != 2 {
		t.Fatalf("patches: %+v", p)
	}
	got := map[string]float64{}
	for _, x := range p {
		got[x.ID] = x.Value.(float64)
	}
	if got["a"] != 10 || got["b"] != 10 {
		t.Fatalf("left: %+v", got)
	}
}

func TestAlignCenterAndMiddle(t *testing.T) {
	objs := boxes()
	p := AlignPatches(AlignCenter, []string{"a", "b"}, objs)
	// union x=10..100, mid=55; a.w=40 -> x=35; b.w=20 -> x=45
	got := map[string]float64{}
	for _, x := range p {
		got[x.ID] = x.Value.(float64)
	}
	if got["a"] != 35 || got["b"] != 45 {
		t.Fatalf("center: %+v", got)
	}
	p = AlignPatches(AlignMiddle, []string{"a", "b"}, objs)
	got = map[string]float64{}
	for _, x := range p {
		got[x.ID] = x.Value.(float64)
	}
	// union y=20..90, mid=55; a.h=20 -> y=45; b.h=40 -> y=35
	if got["a"] != 45 || got["b"] != 35 {
		t.Fatalf("middle: %+v", got)
	}
}

func TestAlignSkipsConnectorsAndNeedsTwo(t *testing.T) {
	objs := boxes()
	if p := AlignPatches(AlignLeft, []string{"a", "n"}, objs); len(p) != 0 {
		t.Fatalf("expected empty, got %+v", p)
	}
	if p := AlignPatches(AlignLeft, []string{"a"}, objs); len(p) != 0 {
		t.Fatalf("expected empty single, got %+v", p)
	}
}

func TestDistributeX(t *testing.T) {
	objs := boxes()
	p := DistributePatches("x", []string{"a", "b", "c"}, objs)
	if len(p) != 3 {
		t.Fatalf("patches: %+v", p)
	}
	// first x=10 w=40, last x=200 w=30, span=220, size=90, gap=65
	// cursor: a@10, b@10+40+65=115, c@115+20+65=200
	got := map[string]float64{}
	for _, x := range p {
		got[x.ID] = x.Value.(float64)
	}
	if got["a"] != 10 || got["b"] != 115 || got["c"] != 200 {
		t.Fatalf("distribute: %+v", got)
	}
}

func TestZFrontBack(t *testing.T) {
	objs := boxes()
	p := ZPatches("front", []string{"a"}, objs)
	if len(p) != 1 || p[0].Value != "a4" {
		t.Fatalf("front: %+v", p)
	}
	p = ZPatches("back", []string{"c"}, objs)
	if len(p) != 1 || p[0].Value != "a-1" {
		t.Fatalf("back: %+v", p)
	}
}

func TestZForward(t *testing.T) {
	objs := boxes()
	p := ZPatches("forward", []string{"a"}, objs)
	if len(p) != 2 {
		t.Fatalf("forward: %+v", p)
	}
	got := map[string]string{}
	for _, x := range p {
		got[x.ID] = x.Value.(string)
	}
	if got["a"] != "a1" || got["b"] != "a0" {
		t.Fatalf("forward swap: %+v", got)
	}
}
