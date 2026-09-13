package draw

import (
	"fmt"
	"math"
	"strings"

	"liro/internal/model"
)

func SVG(objects map[string]model.Object) string {
	sorted := model.SortedObjects(objects)
	if len(sorted) == 0 {
		return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><text x="20" y="40" fill="#6b7088" font-size="16">empty board</text></svg>`
	}
	boxes := make([]Box, 0, len(sorted))
	for _, o := range sorted {
		if o.Type == "connector" {
			pts := ConnectorRoute(o, objects)
			if len(pts) >= 4 {
				boxes = append(boxes, BoundsOfPoints(pts))
			}
			continue
		}
		boxes = append(boxes, AABB(o))
	}
	view := Union(boxes)
	pad := 40.0
	vx, vy := view.X-pad, view.Y-pad
	vw, vh := view.W+pad*2, view.H+pad*2
	if vw < 200 {
		vw = 200
	}
	if vh < 150 {
		vh = 150
	}

	var b strings.Builder
	fmt.Fprintf(&b, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="%.1f %.1f %.1f %.1f">`, vx, vy, vw, vh)
	b.WriteString(`<rect x="` + fmt.Sprintf("%.1f", vx) + `" y="` + fmt.Sprintf("%.1f", vy) + `" width="` + fmt.Sprintf("%.1f", vw) + `" height="` + fmt.Sprintf("%.1f", vh) + `" fill="#f3f5f8"/>`)
	for _, o := range sorted {
		b.WriteString(svgObject(o, objects))
	}
	b.WriteString(`</svg>`)
	return b.String()
}

func svgObject(o model.Object, objects map[string]model.Object) string {
	idAttr := `id="` + xmlEsc(o.ID) + `"`
	fill := svgColor(o.Fill, "#93c5fd")
	stroke := svgColor(o.Stroke, "#1e2a4a")
	sw := o.StrokeWidth
	if sw == 0 && o.Type != "text" {
		sw = 1
	}
	rot := ""
	if o.Rotation != 0 {
		rot = fmt.Sprintf(` transform="rotate(%.1f %.1f %.1f)"`, o.Rotation, o.X+o.W/2, o.Y+o.H/2)
	}

	switch o.Type {
	case "ellipse":
		return fmt.Sprintf(`<ellipse %s cx="%.1f" cy="%.1f" rx="%.1f" ry="%.1f" fill="%s" stroke="%s" stroke-width="%.1f"%s/>`,
			idAttr, o.X+o.W/2, o.Y+o.H/2, o.W/2, o.H/2, fill, stroke, sw, rot)
	case "line", "spline":
		pts := svgPoints(o)
		return fmt.Sprintf(`<polyline %s points="%s" fill="none" stroke="%s" stroke-width="%.1f"/>`, idAttr, pts, stroke, math.Max(sw, 1))
	case "triangle", "diamond", "arrow":
		pts := o.Points
		if len(pts) < 6 {
			pts = PolygonFor(o.Type, o.W, o.H)
		}
		var sb strings.Builder
		for i := 0; i+1 < len(pts); i += 2 {
			if i > 0 {
				sb.WriteByte(' ')
			}
			fmt.Fprintf(&sb, "%.1f,%.1f", o.X+pts[i], o.Y+pts[i+1])
		}
		return fmt.Sprintf(`<polygon %s points="%s" fill="%s" stroke="%s" stroke-width="%.1f"%s/>`, idAttr, sb.String(), fill, stroke, sw, rot)
	case "connector":
		pts := ConnectorRoute(o, objects)
		if len(pts) < 4 {
			return ""
		}
		var sb strings.Builder
		for i := 0; i+1 < len(pts); i += 2 {
			if i > 0 {
				sb.WriteByte(' ')
			}
			fmt.Fprintf(&sb, "%.1f,%.1f", pts[i], pts[i+1])
		}
		return fmt.Sprintf(`<polyline %s points="%s" fill="none" stroke="%s" stroke-width="%.1f" marker-end="url(#arrow)"/>`,
			idAttr, sb.String(), stroke, math.Max(sw, 1.5))
	case "text":
		label := xmlEsc(o.Text)
		if label == "" {
			label = "text"
		}
		fs := o.FontSize
		if fs == 0 {
			fs = DefaultFontSize
		}
		x := o.X + 4
		anchor := ""
		if o.TextAlign == "center" {
			x = o.X + o.W/2
			anchor = ` text-anchor="middle"`
		} else if o.TextAlign == "right" {
			x = o.X + o.W - 4
			anchor = ` text-anchor="end"`
		}
		weight := ""
		if o.Bold {
			weight = ` font-weight="700"`
		}
		style := ""
		if o.Italic {
			style = ` font-style="italic"`
		}
		family := ""
		if o.FontFamily != "" {
			family = ` font-family="` + xmlEsc(o.FontFamily) + `"`
		}
		return fmt.Sprintf(`<text %s x="%.1f" y="%.1f" fill="%s" font-size="%.1f"%s%s%s%s%s>%s</text>`,
			idAttr, x, o.Y+fs, fill, fs, anchor, weight, style, family, rot, label)
	case "sticker":
		label := xmlEsc(o.Text)
		if label == "" {
			label = "🔥"
		}
		fs := math.Min(o.W, o.H)
		if fs < 1 {
			fs = 64
		}
		return fmt.Sprintf(`<text %s x="%.1f" y="%.1f" text-anchor="middle" dominant-baseline="central" font-size="%.1f"%s>%s</text>`,
			idAttr, o.X+o.W/2, o.Y+o.H/2, fs, rot, label)
	default:
		dash := ""
		if o.Type == "group" {
			dash = ` stroke-dasharray="6 4"`
		}
		rect := fmt.Sprintf(`<rect %s x="%.1f" y="%.1f" width="%.1f" height="%.1f" fill="%s" stroke="%s" stroke-width="%.1f"%s%s/>`,
			idAttr, o.X, o.Y, math.Max(o.W, 1), math.Max(o.H, 1), fill, stroke, sw, dash, rot)
		if o.Text == "" {
			return rect
		}
		fs := 14.0
		if o.Type == "postit" {
			fs = 16
		}
		return rect + fmt.Sprintf(`<text x="%.1f" y="%.1f" fill="%s" font-size="%.1f">%s</text>`,
			o.X+8, o.Y+20, TextFill, fs, xmlEsc(o.Text))
	}
}

func svgPoints(o model.Object) string {
	if len(o.Points) < 4 {
		return fmt.Sprintf("%.1f,%.1f %.1f,%.1f", o.X, o.Y, o.X+o.W, o.Y+o.H)
	}
	var b strings.Builder
	for i := 0; i+1 < len(o.Points); i += 2 {
		if i > 0 {
			b.WriteByte(' ')
		}
		fmt.Fprintf(&b, "%.1f,%.1f", o.X+o.Points[i], o.Y+o.Points[i+1])
	}
	return b.String()
}

func svgColor(c, fallback string) string {
	c = strings.TrimSpace(c)
	if c == "" || c == "transparent" {
		if c == "transparent" {
			return "none"
		}
		return fallback
	}
	return xmlEsc(c)
}

func xmlEsc(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	s = strings.ReplaceAll(s, `"`, "&quot;")
	return s
}
