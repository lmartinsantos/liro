package draw

import (
	"fmt"
	"math"
	"strings"

	"liro/internal/id"
	"liro/internal/model"
)

const (
	DefaultFill        = "#93c5fd"
	DefaultStroke      = "#1e2a4a"
	PostitFill         = "#fef08a"
	PostitStroke       = "#ca8a04"
	FrameFill          = "#faf8f3"
	FrameStroke        = "#c4b8a5"
	LaneFill           = "#f3efe6"
	LaneStroke         = "#b8a99a"
	TextFill           = "#1e2a4a"
	GroupStroke        = "#c8cdd8"
	DefaultStrokeWidth = 2
	DefaultFontSize    = 20
	DefaultFont        = "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
)

var validTypes = map[string]bool{
	"rect": true, "ellipse": true, "line": true, "spline": true,
	"postit": true, "triangle": true, "diamond": true, "arrow": true,
	"text": true, "frame": true, "lane": true, "group": true,
	"connector": true, "image": true, "sticker": true,
}

type Spec struct {
	ID          string
	Type        string
	X           float64
	Y           float64
	W           float64
	H           float64
	Rotation    *float64
	Fill        string
	Stroke      string
	StrokeWidth *float64
	Points      []float64
	Text        string
	ParentID    string
	FromID      string
	ToID        string
	FromSide    string
	ToSide      string
	FromOffset  *float64
	ToOffset    *float64
	Dir         string
	Src         string
	FontFamily  string
	FontSize    *float64
	Bold        *bool
	Italic      *bool
	TextAlign   string
}

type Box struct {
	X, Y, W, H float64
}

func AABB(o model.Object) Box {
	if (o.Type == "line" || o.Type == "spline") && len(o.Points) >= 2 {
		minX, minY := math.Inf(1), math.Inf(1)
		maxX, maxY := math.Inf(-1), math.Inf(-1)
		for i := 0; i+1 < len(o.Points); i += 2 {
			px := o.X + o.Points[i]
			py := o.Y + o.Points[i+1]
			if px < minX {
				minX = px
			}
			if py < minY {
				minY = py
			}
			if px > maxX {
				maxX = px
			}
			if py > maxY {
				maxY = py
			}
		}
		return Box{X: minX, Y: minY, W: math.Max(1, maxX-minX), H: math.Max(1, maxY-minY)}
	}
	return Box{X: o.X, Y: o.Y, W: o.W, H: o.H}
}

func Union(boxes []Box) Box {
	if len(boxes) == 0 {
		return Box{}
	}
	minX, minY := boxes[0].X, boxes[0].Y
	maxR, maxB := boxes[0].X+boxes[0].W, boxes[0].Y+boxes[0].H
	for _, b := range boxes[1:] {
		if b.X < minX {
			minX = b.X
		}
		if b.Y < minY {
			minY = b.Y
		}
		if r := b.X + b.W; r > maxR {
			maxR = r
		}
		if bot := b.Y + b.H; bot > maxB {
			maxB = bot
		}
	}
	return Box{X: minX, Y: minY, W: maxR - minX, H: maxB - minY}
}

func TrianglePoints(w, h float64) []float64 {
	return []float64{w / 2, 0, w, h, 0, h}
}

func DiamondPoints(w, h float64) []float64 {
	return []float64{w / 2, 0, w, h / 2, w / 2, h, 0, h / 2}
}

func ArrowPoints(w, h float64) []float64 {
	return []float64{
		0, h * 0.32,
		w * 0.58, h * 0.32,
		w * 0.58, 0,
		w, h / 2,
		w * 0.58, h,
		w * 0.58, h * 0.68,
		0, h * 0.68,
	}
}

func PolygonFor(typ string, w, h float64) []float64 {
	switch typ {
	case "triangle":
		return TrianglePoints(w, h)
	case "diamond":
		return DiamondPoints(w, h)
	case "arrow":
		return ArrowPoints(w, h)
	default:
		return nil
	}
}

func Build(spec Spec, objects map[string]model.Object) (model.Object, error) {
	typ := strings.TrimSpace(spec.Type)
	if !validTypes[typ] {
		return model.Object{}, fmt.Errorf("unknown object type %q", spec.Type)
	}
	obj := model.Object{
		ID:          spec.ID,
		Type:        typ,
		X:           spec.X,
		Y:           spec.Y,
		W:           spec.W,
		H:           spec.H,
		Fill:        spec.Fill,
		Stroke:      spec.Stroke,
		Points:      spec.Points,
		Text:        spec.Text,
		Attachments: []model.Attachment{},
		ParentID:    spec.ParentID,
		FromID:      spec.FromID,
		ToID:        spec.ToID,
		FromSide:    spec.FromSide,
		ToSide:      spec.ToSide,
		FromOffset:  spec.FromOffset,
		ToOffset:    spec.ToOffset,
		Dir:         spec.Dir,
		Src:         spec.Src,
		FontFamily:  spec.FontFamily,
		Bold:        spec.Bold != nil && *spec.Bold,
		Italic:      spec.Italic != nil && *spec.Italic,
		TextAlign:   spec.TextAlign,
	}
	if obj.ID == "" {
		obj.ID = id.New("obj")
	}
	obj.Z = model.NextZ(objects)
	if spec.Rotation != nil {
		obj.Rotation = *spec.Rotation
	}
	if spec.StrokeWidth != nil {
		obj.StrokeWidth = *spec.StrokeWidth
	}
	if spec.FontSize != nil {
		obj.FontSize = *spec.FontSize
	}

	applyDefaults(&obj)
	return obj, nil
}

func applyDefaults(obj *model.Object) {
	switch obj.Type {
	case "postit":
		if obj.W == 0 {
			obj.W = 180
		}
		if obj.H == 0 {
			obj.H = 160
		}
		if obj.Fill == "" {
			obj.Fill = PostitFill
		}
		if obj.Stroke == "" {
			obj.Stroke = PostitStroke
		}
		if obj.StrokeWidth == 0 {
			obj.StrokeWidth = 1
		}
		if obj.FontFamily == "" {
			obj.FontFamily = DefaultFont
		}
	case "text":
		if obj.W == 0 {
			obj.W = 240
		}
		if obj.H == 0 {
			obj.H = 48
		}
		if obj.Fill == "" {
			obj.Fill = TextFill
		}
		if obj.Stroke == "" {
			obj.Stroke = "transparent"
		}
		obj.StrokeWidth = 0
		if obj.FontSize == 0 {
			obj.FontSize = DefaultFontSize
		}
		if obj.FontFamily == "" {
			obj.FontFamily = DefaultFont
		}
	case "frame":
		if obj.W == 0 {
			obj.W = 480
		}
		if obj.H == 0 {
			obj.H = 320
		}
		if obj.Fill == "" {
			obj.Fill = FrameFill
		}
		if obj.Stroke == "" {
			obj.Stroke = FrameStroke
		}
		if obj.StrokeWidth == 0 {
			obj.StrokeWidth = 1
		}
		if obj.Text == "" {
			obj.Text = "Frame"
		}
	case "lane":
		if obj.W == 0 {
			obj.W = 240
		}
		if obj.H == 0 {
			obj.H = 180
		}
		if obj.Fill == "" {
			obj.Fill = LaneFill
		}
		if obj.Stroke == "" {
			obj.Stroke = LaneStroke
		}
		if obj.StrokeWidth == 0 {
			obj.StrokeWidth = 1
		}
		if obj.Text == "" {
			obj.Text = "Lane"
		}
		if obj.Dir == "" {
			obj.Dir = "h"
		}
	case "group":
		if obj.Fill == "" {
			obj.Fill = "transparent"
		}
		if obj.Stroke == "" {
			obj.Stroke = GroupStroke
		}
		if obj.StrokeWidth == 0 {
			obj.StrokeWidth = 1
		}
	case "line":
		if obj.Fill == "" {
			obj.Fill = "transparent"
		}
		if obj.Stroke == "" {
			obj.Stroke = DefaultStroke
		}
		if obj.StrokeWidth == 0 {
			obj.StrokeWidth = DefaultStrokeWidth
		}
		if len(obj.Points) < 4 {
			if obj.W == 0 {
				obj.W = 160
			}
			obj.Points = []float64{0, 0, obj.W, 0}
			if obj.H == 0 {
				obj.H = 1
			}
		} else {
			obj.W = math.Abs(obj.Points[2])
			obj.H = math.Max(1, math.Abs(obj.Points[3]))
		}
	case "spline":
		if obj.Fill == "" {
			obj.Fill = "transparent"
		}
		if obj.Stroke == "" {
			obj.Stroke = DefaultStroke
		}
		if obj.StrokeWidth == 0 {
			obj.StrokeWidth = DefaultStrokeWidth
		}
		if obj.W == 0 {
			obj.W = 1
		}
		if obj.H == 0 {
			obj.H = 1
		}
	case "connector":
		if obj.Fill == "" {
			obj.Fill = DefaultStroke
		}
		if obj.Stroke == "" {
			obj.Stroke = DefaultStroke
		}
		if obj.StrokeWidth == 0 {
			obj.StrokeWidth = DefaultStrokeWidth
		}
		if obj.W == 0 {
			obj.W = 1
		}
		if obj.H == 0 {
			obj.H = 1
		}
	case "image":
		if obj.W == 0 {
			obj.W = 240
		}
		if obj.H == 0 {
			obj.H = 180
		}
		if obj.Fill == "" {
			obj.Fill = "transparent"
		}
	case "sticker":
		if obj.W == 0 {
			obj.W = 64
		}
		if obj.H == 0 {
			obj.H = 64
		}
		if obj.Fill == "" {
			obj.Fill = "transparent"
		}
		if obj.Stroke == "" {
			obj.Stroke = "transparent"
		}
		obj.StrokeWidth = 0
		if obj.Text == "" {
			obj.Text = "🔥"
		}
	default:
		if obj.W == 0 {
			obj.W = 160
		}
		if obj.H == 0 {
			if obj.Type == "triangle" || obj.Type == "diamond" || obj.Type == "arrow" {
				obj.H = 120
			} else {
				obj.H = 100
			}
		}
		if obj.Fill == "" {
			obj.Fill = DefaultFill
		}
		if obj.Stroke == "" {
			obj.Stroke = DefaultStroke
		}
		if obj.StrokeWidth == 0 {
			obj.StrokeWidth = DefaultStrokeWidth
		}
		if poly := PolygonFor(obj.Type, obj.W, obj.H); poly != nil && len(obj.Points) == 0 {
			obj.Points = poly
		}
	}
	if obj.W < 4 && obj.Type != "connector" && obj.Type != "line" && obj.Type != "spline" {
		obj.W = 4
	}
	if obj.H < 4 && obj.Type != "connector" && obj.Type != "line" && obj.Type != "spline" {
		obj.H = 4
	}
}

type Side string

const (
	SideTop    Side = "top"
	SideRight  Side = "right"
	SideBottom Side = "bottom"
	SideLeft   Side = "left"
)

var sides = []Side{SideTop, SideRight, SideBottom, SideLeft}

func SideAnchor(o model.Object, side Side) (x, y float64) {
	return SideAnchorAt(o, side, 0.5)
}

func NearestSides(from, to model.Object) (fromSide, toSide Side) {
	bestFrom, bestTo := SideRight, SideLeft
	best := math.Inf(1)
	for _, fs := range sides {
		ax, ay := SideAnchor(from, fs)
		for _, ts := range sides {
			bx, by := SideAnchor(to, ts)
			d := math.Hypot(ax-bx, ay-by)
			if d < best {
				best = d
				bestFrom, bestTo = fs, ts
			}
		}
	}
	return bestFrom, bestTo
}

func ParseSide(s string) (Side, bool) {
	switch Side(s) {
	case SideTop, SideRight, SideBottom, SideLeft:
		return Side(s), true
	default:
		return "", false
	}
}

func Connect(from, to model.Object, fromSide, toSide string, objects map[string]model.Object) (model.Object, error) {
	fs, ok1 := ParseSide(fromSide)
	ts, ok2 := ParseSide(toSide)
	if !ok1 || !ok2 {
		nfs, nts := NearestSides(from, to)
		if !ok1 {
			fs = nfs
		}
		if !ok2 {
			ts = nts
		}
	}
	return Build(Spec{
		Type:       "connector",
		FromID:     from.ID,
		ToID:       to.ID,
		FromSide:   string(fs),
		ToSide:     string(ts),
		FromOffset: floatPtr(0.5),
		ToOffset:   floatPtr(0.5),
		Fill:       DefaultStroke,
		Stroke:     DefaultStroke,
	}, objects)
}

func floatPtr(v float64) *float64 { return &v }

func GroupAround(members []model.Object, objects map[string]model.Object) (model.Object, error) {
	boxes := make([]Box, 0, len(members))
	for _, m := range members {
		boxes = append(boxes, AABB(m))
	}
	box := Union(boxes)
	return Build(Spec{
		Type:   "group",
		X:      box.X - 8,
		Y:      box.Y - 8,
		W:      box.W + 16,
		H:      box.H + 16,
		Fill:   "transparent",
		Stroke: GroupStroke,
	}, objects)
}

type SceneItem struct {
	ID       string  `json:"id"`
	Type     string  `json:"type"`
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
	W        float64 `json:"w"`
	H        float64 `json:"h"`
	Z        string  `json:"z"`
	Text     string  `json:"text,omitempty"`
	ParentID string  `json:"parentId,omitempty"`
	FromID   string  `json:"fromId,omitempty"`
	ToID     string  `json:"toId,omitempty"`
}

func Scene(objects map[string]model.Object) []SceneItem {
	sorted := model.SortedObjects(objects)
	out := make([]SceneItem, 0, len(sorted))
	for _, o := range sorted {
		b := AABB(o)
		out = append(out, SceneItem{
			ID:       o.ID,
			Type:     o.Type,
			X:        b.X,
			Y:        b.Y,
			W:        b.W,
			H:        b.H,
			Z:        o.Z,
			Text:     o.Text,
			ParentID: o.ParentID,
			FromID:   o.FromID,
			ToID:     o.ToID,
		})
	}
	return out
}
