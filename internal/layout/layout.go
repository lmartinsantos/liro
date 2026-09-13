package layout

import (
	"strconv"

	"liro/internal/draw"
	"liro/internal/model"
)

type Align string

const (
	AlignLeft   Align = "left"
	AlignCenter Align = "center"
	AlignRight  Align = "right"
	AlignTop    Align = "top"
	AlignMiddle Align = "middle"
	AlignBottom Align = "bottom"
)

type Patch struct {
	ID    string
	Path  string
	Value any
}

func Targets(ids []string, objects map[string]model.Object) []model.Object {
	out := make([]model.Object, 0, len(ids))
	for _, id := range ids {
		o, ok := objects[id]
		if !ok || o.Type == "connector" {
			continue
		}
		out = append(out, o)
	}
	return out
}

func AlignPatches(kind Align, ids []string, objects map[string]model.Object) []Patch {
	items := Targets(ids, objects)
	if len(items) < 2 {
		return nil
	}
	type pair struct {
		o model.Object
		b draw.Box
	}
	boxes := make([]pair, 0, len(items))
	minX, minY := items[0].X, items[0].Y
	maxR, maxB := items[0].X, items[0].Y
	for i, o := range items {
		b := draw.AABB(o)
		boxes = append(boxes, pair{o: o, b: b})
		if i == 0 || b.X < minX {
			minX = b.X
		}
		if i == 0 || b.Y < minY {
			minY = b.Y
		}
		if r := b.X + b.W; i == 0 || r > maxR {
			maxR = r
		}
		if bot := b.Y + b.H; i == 0 || bot > maxB {
			maxB = bot
		}
	}
	midX := (minX + maxR) / 2
	midY := (minY + maxB) / 2
	out := make([]Patch, 0, len(boxes))
	for _, p := range boxes {
		dx := p.o.X - p.b.X
		dy := p.o.Y - p.b.Y
		switch kind {
		case AlignLeft:
			out = append(out, Patch{ID: p.o.ID, Path: "x", Value: minX + dx})
		case AlignRight:
			out = append(out, Patch{ID: p.o.ID, Path: "x", Value: maxR - p.b.W + dx})
		case AlignCenter:
			out = append(out, Patch{ID: p.o.ID, Path: "x", Value: midX - p.b.W/2 + dx})
		case AlignTop:
			out = append(out, Patch{ID: p.o.ID, Path: "y", Value: minY + dy})
		case AlignBottom:
			out = append(out, Patch{ID: p.o.ID, Path: "y", Value: maxB - p.b.H + dy})
		case AlignMiddle:
			out = append(out, Patch{ID: p.o.ID, Path: "y", Value: midY - p.b.H/2 + dy})
		}
	}
	return out
}

func DistributePatches(axis string, ids []string, objects map[string]model.Object) []Patch {
	items := Targets(ids, objects)
	if len(items) < 3 {
		return nil
	}
	type pair struct {
		o model.Object
		b draw.Box
	}
	boxes := make([]pair, len(items))
	for i, o := range items {
		boxes[i] = pair{o: o, b: draw.AABB(o)}
	}
	if axis == "y" {
		for i := 0; i < len(boxes); i++ {
			for j := i + 1; j < len(boxes); j++ {
				if boxes[j].b.Y < boxes[i].b.Y {
					boxes[i], boxes[j] = boxes[j], boxes[i]
				}
			}
		}
	} else {
		axis = "x"
		for i := 0; i < len(boxes); i++ {
			for j := i + 1; j < len(boxes); j++ {
				if boxes[j].b.X < boxes[i].b.X {
					boxes[i], boxes[j] = boxes[j], boxes[i]
				}
			}
		}
	}
	first := boxes[0].b
	last := boxes[len(boxes)-1].b
	var span, size float64
	if axis == "x" {
		span = last.X + last.W - first.X
		for _, p := range boxes {
			size += p.b.W
		}
	} else {
		span = last.Y + last.H - first.Y
		for _, p := range boxes {
			size += p.b.H
		}
	}
	gap := (span - size) / float64(len(boxes)-1)
	out := make([]Patch, 0, len(boxes))
	cursor := first.X
	if axis == "y" {
		cursor = first.Y
	}
	for _, p := range boxes {
		if axis == "x" {
			out = append(out, Patch{ID: p.o.ID, Path: "x", Value: cursor + (p.o.X - p.b.X)})
			cursor += p.b.W + gap
		} else {
			out = append(out, Patch{ID: p.o.ID, Path: "y", Value: cursor + (p.o.Y - p.b.Y)})
			cursor += p.b.H + gap
		}
	}
	return out
}

func ZPatches(action string, ids []string, objects map[string]model.Object) []Patch {
	selected := map[string]bool{}
	for _, id := range ids {
		if _, ok := objects[id]; ok {
			selected[id] = true
		}
	}
	if len(selected) == 0 {
		return nil
	}
	sorted := model.SortedObjects(objects)
	if action == "front" {
		n := 0
		for _, o := range sorted {
			if z := model.ParseZ(o.Z); z >= n {
				n = z
			}
		}
		n++
		out := make([]Patch, 0, len(ids))
		for _, id := range ids {
			if _, ok := objects[id]; !ok {
				continue
			}
			out = append(out, Patch{ID: id, Path: "z", Value: zName(n)})
			n++
		}
		return out
	}
	if action == "back" {
		n := 0
		if len(sorted) > 0 {
			n = model.ParseZ(sorted[0].Z)
			for _, o := range sorted[1:] {
				if z := model.ParseZ(o.Z); z < n {
					n = z
				}
			}
		}
		n -= len(selected)
		out := make([]Patch, 0, len(ids))
		for _, id := range ids {
			if _, ok := objects[id]; !ok {
				continue
			}
			out = append(out, Patch{ID: id, Path: "z", Value: zName(n)})
			n++
		}
		return out
	}
	dir := -1
	if action == "forward" {
		dir = 1
	}
	order := make([]model.Object, len(sorted))
	copy(order, sorted)
	if dir == 1 {
		for i, j := 0, len(order)-1; i < j; i, j = i+1, j-1 {
			order[i], order[j] = order[j], order[i]
		}
	}
	out := []Patch{}
	for _, obj := range order {
		if !selected[obj.ID] {
			continue
		}
		idx := -1
		for i := range sorted {
			if sorted[i].ID == obj.ID {
				idx = i
				break
			}
		}
		swap := idx + dir
		if idx < 0 || swap < 0 || swap >= len(sorted) || selected[sorted[swap].ID] {
			continue
		}
		out = append(out,
			Patch{ID: obj.ID, Path: "z", Value: sorted[swap].Z},
			Patch{ID: sorted[swap].ID, Path: "z", Value: obj.Z},
		)
		sorted[idx], sorted[swap] = sorted[swap], sorted[idx]
	}
	return out
}

func zName(n int) string {
	return "a" + strconv.Itoa(n)
}
