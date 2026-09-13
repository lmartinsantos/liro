package draw

import (
	"math"

	"liro/internal/model"
)

const ConnectorStub = 24.0

type Pt struct {
	X, Y float64
}

func clamp01(t float64) float64 {
	if math.IsNaN(t) {
		return 0.5
	}
	if t < 0 {
		return 0
	}
	if t > 1 {
		return 1
	}
	return t
}

func almostEq(a, b, eps float64) bool {
	return math.Abs(a-b) < eps
}

// SideAnchorAt returns the point on the given side at offset t in [0,1].
func SideAnchorAt(o model.Object, side Side, offset float64) (x, y float64) {
	b := AABB(o)
	t := clamp01(offset)
	switch side {
	case SideTop:
		return b.X + b.W*t, b.Y
	case SideBottom:
		return b.X + b.W*t, b.Y + b.H
	case SideLeft:
		return b.X, b.Y + b.H*t
	default:
		return b.X + b.W, b.Y + b.H*t
	}
}

func SideNormal(side Side) Pt {
	switch side {
	case SideTop:
		return Pt{0, -1}
	case SideBottom:
		return Pt{0, 1}
	case SideLeft:
		return Pt{-1, 0}
	default:
		return Pt{1, 0}
	}
}

func simplifyOrthogonal(pts []Pt) []Pt {
	if len(pts) <= 2 {
		out := make([]Pt, len(pts))
		copy(out, pts)
		return out
	}
	out := []Pt{pts[0]}
	for i := 1; i < len(pts); i++ {
		p := pts[i]
		last := out[len(out)-1]
		if almostEq(last.X, p.X, 0.5) && almostEq(last.Y, p.Y, 0.5) {
			continue
		}
		out = append(out, p)
	}
	i := 1
	for i < len(out)-1 {
		a, b, c := out[i-1], out[i], out[i+1]
		colH := almostEq(a.Y, b.Y, 0.5) && almostEq(b.Y, c.Y, 0.5)
		colV := almostEq(a.X, b.X, 0.5) && almostEq(b.X, c.X, 0.5)
		if colH || colV {
			out = append(out[:i], out[i+1:]...)
			continue
		}
		i++
	}
	return out
}

func routeBetweenStubs(a Pt, fromSide Side, b Pt, toSide Side) []Pt {
	fromH := fromSide == SideLeft || fromSide == SideRight
	toH := toSide == SideLeft || toSide == SideRight

	if fromH && toH {
		if (fromSide == SideRight && a.X <= b.X) || (fromSide == SideLeft && a.X >= b.X) {
			if almostEq(a.Y, b.Y, 0.5) {
				return []Pt{a, {b.X, a.Y}, b}
			}
			midX := (a.X + b.X) / 2
			return []Pt{a, {midX, a.Y}, {midX, b.Y}, b}
		}
		midY := (a.Y + b.Y) / 2
		return []Pt{a, {a.X, midY}, {b.X, midY}, b}
	}

	if !fromH && !toH {
		if (fromSide == SideBottom && a.Y <= b.Y) || (fromSide == SideTop && a.Y >= b.Y) {
			if almostEq(a.X, b.X, 0.5) {
				return []Pt{a, {a.X, b.Y}, b}
			}
			midY := (a.Y + b.Y) / 2
			return []Pt{a, {a.X, midY}, {b.X, midY}, b}
		}
		midX := (a.X + b.X) / 2
		return []Pt{a, {midX, a.Y}, {midX, b.Y}, b}
	}

	if fromH {
		return []Pt{a, {b.X, a.Y}, b}
	}
	return []Pt{a, {a.X, b.Y}, b}
}

func enforceOrthogonal(pts []Pt) []Pt {
	if len(pts) <= 1 {
		out := make([]Pt, len(pts))
		copy(out, pts)
		return out
	}
	out := []Pt{pts[0]}
	for i := 1; i < len(pts); i++ {
		prev := out[len(out)-1]
		cur := pts[i]
		if almostEq(prev.X, cur.X, 0.5) || almostEq(prev.Y, cur.Y, 0.5) {
			out = append(out, cur)
			continue
		}
		out = append(out, Pt{cur.X, prev.Y}, cur)
	}
	return simplifyOrthogonal(out)
}

func flatPts(pts []Pt) []float64 {
	out := make([]float64, 0, len(pts)*2)
	for _, p := range pts {
		out = append(out, p.X, p.Y)
	}
	return out
}

func parseWaypoints(waypoints []float64) []Pt {
	out := make([]Pt, 0, len(waypoints)/2)
	for i := 0; i+1 < len(waypoints); i += 2 {
		out = append(out, Pt{waypoints[i], waypoints[i+1]})
	}
	return out
}

// OrthogonalRoute builds a Manhattan polyline between two objects.
// waypoints are interior corners only; empty means fully automatic.
func OrthogonalRoute(from, to model.Object, fromSide, toSide Side, fromOffset, toOffset float64, waypoints []float64, stub float64) []float64 {
	if stub <= 0 {
		stub = ConnectorStub
	}
	sx, sy := SideAnchorAt(from, fromSide, fromOffset)
	ex, ey := SideAnchorAt(to, toSide, toOffset)
	n0 := SideNormal(fromSide)
	n1 := SideNormal(toSide)
	stubA := Pt{sx + n0.X*stub, sy + n0.Y*stub}
	stubB := Pt{ex + n1.X*stub, ey + n1.Y*stub}

	var middle []Pt
	custom := parseWaypoints(waypoints)
	if len(custom) > 0 {
		chain := append([]Pt{stubA}, custom...)
		chain = append(chain, stubB)
		middle = enforceOrthogonal(chain)
	} else {
		middle = simplifyOrthogonal(routeBetweenStubs(stubA, fromSide, stubB, toSide))
	}

	full := []Pt{{sx, sy}}
	full = append(full, middle...)
	full = append(full, Pt{ex, ey})
	return flatPts(simplifyOrthogonal(full))
}

// ConnectorRoute resolves sides/offsets from a connector object and routes it.
func ConnectorRoute(conn model.Object, objects map[string]model.Object) []float64 {
	from, ok1 := objects[conn.FromID]
	to, ok2 := objects[conn.ToID]
	if !ok1 || !ok2 {
		return nil
	}
	fs, okf := ParseSide(conn.FromSide)
	ts, okt := ParseSide(conn.ToSide)
	if !okf || !okt {
		nfs, nts := NearestSides(from, to)
		if !okf {
			fs = nfs
		}
		if !okt {
			ts = nts
		}
	}
	fromOff, toOff := 0.5, 0.5
	if conn.FromOffset != nil {
		fromOff = clamp01(*conn.FromOffset)
	}
	if conn.ToOffset != nil {
		toOff = clamp01(*conn.ToOffset)
	}
	return OrthogonalRoute(from, to, fs, ts, fromOff, toOff, conn.Points, ConnectorStub)
}

// BoundsOfPoints returns the AABB of a flat polyline.
func BoundsOfPoints(pts []float64) Box {
	if len(pts) < 2 {
		return Box{0, 0, 1, 1}
	}
	minX, minY := math.Inf(1), math.Inf(1)
	maxX, maxY := math.Inf(-1), math.Inf(-1)
	for i := 0; i+1 < len(pts); i += 2 {
		if pts[i] < minX {
			minX = pts[i]
		}
		if pts[i+1] < minY {
			minY = pts[i+1]
		}
		if pts[i] > maxX {
			maxX = pts[i]
		}
		if pts[i+1] > maxY {
			maxY = pts[i+1]
		}
	}
	return Box{minX, minY, math.Max(1, maxX-minX), math.Max(1, maxY-minY)}
}
