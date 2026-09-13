package liromcp

import "liro/internal/draw"

type ObjectSpec struct {
	Type        string    `json:"type" jsonschema:"rect, ellipse, line, spline, postit, triangle, diamond, arrow, text, frame, lane, group, connector, image, or sticker"`
	X           float64   `json:"x"`
	Y           float64   `json:"y"`
	W           float64   `json:"w,omitempty"`
	H           float64   `json:"h,omitempty"`
	Rotation    *float64  `json:"rotation,omitempty"`
	Fill        string    `json:"fill,omitempty"`
	Stroke      string    `json:"stroke,omitempty"`
	StrokeWidth *float64  `json:"strokeWidth,omitempty"`
	Points      []float64 `json:"points,omitempty"`
	Text        string    `json:"text,omitempty"`
	ParentID    string    `json:"parentId,omitempty"`
	FromID      string    `json:"fromId,omitempty"`
	ToID        string    `json:"toId,omitempty"`
	FromSide    string    `json:"fromSide,omitempty"`
	ToSide      string    `json:"toSide,omitempty"`
	Dir         string    `json:"dir,omitempty"`
	Src         string    `json:"src,omitempty"`
	FontFamily  string    `json:"fontFamily,omitempty"`
	FontSize    *float64  `json:"fontSize,omitempty"`
	Bold        *bool     `json:"bold,omitempty"`
	Italic      *bool     `json:"italic,omitempty"`
	TextAlign   string    `json:"textAlign,omitempty"`
}

func (s ObjectSpec) toDraw() draw.Spec {
	return draw.Spec{
		Type:        s.Type,
		X:           s.X,
		Y:           s.Y,
		W:           s.W,
		H:           s.H,
		Rotation:    s.Rotation,
		Fill:        s.Fill,
		Stroke:      s.Stroke,
		StrokeWidth: s.StrokeWidth,
		Points:      s.Points,
		Text:        s.Text,
		ParentID:    s.ParentID,
		FromID:      s.FromID,
		ToID:        s.ToID,
		FromSide:    s.FromSide,
		ToSide:      s.ToSide,
		Dir:         s.Dir,
		Src:         s.Src,
		FontFamily:  s.FontFamily,
		FontSize:    s.FontSize,
		Bold:        s.Bold,
		Italic:      s.Italic,
		TextAlign:   s.TextAlign,
	}
}

type ObjectPatch struct {
	ID     string         `json:"id"`
	Fields map[string]any `json:"fields"`
}
