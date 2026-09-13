package draw

import (
	"math"
	"testing"

	"liro/internal/model"
)

func TestOrthogonalRouteHorizontal(t *testing.T) {
	left := model.Object{ID: "l", Type: "rect", X: 0, Y: 0, W: 40, H: 40}
	right := model.Object{ID: "r", Type: "rect", X: 200, Y: 0, W: 40, H: 40}
	pts := OrthogonalRoute(left, right, SideRight, SideLeft, 0.5, 0.5, nil, ConnectorStub)
	if len(pts) < 4 {
		t.Fatalf("expected polyline, got %v", pts)
	}
	// Start at right mid of left box
	if math.Abs(pts[0]-40) > 0.1 || math.Abs(pts[1]-20) > 0.1 {
		t.Fatalf("start %v", pts[:2])
	}
	// End at left mid of right box
	n := len(pts)
	if math.Abs(pts[n-2]-200) > 0.1 || math.Abs(pts[n-1]-20) > 0.1 {
		t.Fatalf("end %v", pts[n-2:])
	}
	// All segments orthogonal
	for i := 0; i+3 < len(pts); i += 2 {
		dx := math.Abs(pts[i+2] - pts[i])
		dy := math.Abs(pts[i+3] - pts[i+1])
		if dx > 0.5 && dy > 0.5 {
			t.Fatalf("non-orthogonal segment at %d: %v", i, pts)
		}
	}
}

func TestOrthogonalRouteLShape(t *testing.T) {
	a := model.Object{ID: "a", Type: "rect", X: 0, Y: 0, W: 40, H: 40}
	b := model.Object{ID: "b", Type: "rect", X: 200, Y: 200, W: 40, H: 40}
	pts := OrthogonalRoute(a, b, SideRight, SideTop, 0.5, 0.5, nil, ConnectorStub)
	if len(pts) < 6 {
		t.Fatalf("expected elbow, got %v", pts)
	}
	for i := 0; i+3 < len(pts); i += 2 {
		dx := math.Abs(pts[i+2] - pts[i])
		dy := math.Abs(pts[i+3] - pts[i+1])
		if dx > 0.5 && dy > 0.5 {
			t.Fatalf("non-orthogonal: %v", pts)
		}
	}
}

func TestConnectorRouteWithWaypoints(t *testing.T) {
	left := model.Object{ID: "l", Type: "rect", X: 0, Y: 0, W: 40, H: 40}
	right := model.Object{ID: "r", Type: "rect", X: 200, Y: 0, W: 40, H: 40}
	conn := model.Object{
		ID: "c", Type: "connector", FromID: "l", ToID: "r",
		FromSide: "right", ToSide: "left",
		Points: []float64{120, 80},
	}
	objs := map[string]model.Object{"l": left, "r": right, "c": conn}
	pts := ConnectorRoute(conn, objs)
	if len(pts) < 6 {
		t.Fatalf("waypoints route: %v", pts)
	}
}

func TestSideAnchorAtOffset(t *testing.T) {
	o := model.Object{Type: "rect", X: 10, Y: 20, W: 100, H: 50}
	x, y := SideAnchorAt(o, SideTop, 0)
	if x != 10 || y != 20 {
		t.Fatalf("top 0: %v %v", x, y)
	}
	x, y = SideAnchorAt(o, SideTop, 1)
	if x != 110 || y != 20 {
		t.Fatalf("top 1: %v %v", x, y)
	}
}
