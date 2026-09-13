package model

import (
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
)

type User struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

type Meta struct {
	ID           string     `json:"id"`
	Name         string     `json:"name"`
	CreatedAt    time.Time  `json:"createdAt"`
	Users        []User     `json:"users"`
	ArchivedAt   *time.Time `json:"archivedAt,omitempty"`
	PasswordHash string     `json:"passwordHash,omitempty"`
}

// PublicMeta is safe to send to clients (never includes PasswordHash).
type PublicMeta struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	CreatedAt   time.Time  `json:"createdAt"`
	Users       []User     `json:"users"`
	ArchivedAt  *time.Time `json:"archivedAt,omitempty"`
	HasPassword bool       `json:"hasPassword"`
}

func (m Meta) HasPassword() bool {
	return m.PasswordHash != ""
}

func (m Meta) IsArchived() bool {
	return m.ArchivedAt != nil
}

func (m Meta) Public() PublicMeta {
	users := m.Users
	if users == nil {
		users = []User{}
	}
	return PublicMeta{
		ID:          m.ID,
		Name:        m.Name,
		CreatedAt:   m.CreatedAt,
		Users:       users,
		ArchivedAt:  m.ArchivedAt,
		HasPassword: m.HasPassword(),
	}
}

// Limited is what getBoard returns before unlock on a password-protected board.
func (m Meta) Limited() PublicMeta {
	return PublicMeta{
		ID:          m.ID,
		Name:        m.Name,
		CreatedAt:   m.CreatedAt,
		Users:       []User{},
		ArchivedAt:  m.ArchivedAt,
		HasPassword: m.HasPassword(),
	}
}

type Attachment struct {
	ID         string  `json:"id"`
	Type       string  `json:"type"`
	Emoji      string  `json:"emoji,omitempty"`
	OffsetX    float64 `json:"offsetX,omitempty"`
	OffsetY    float64 `json:"offsetY,omitempty"`
	AuthorID   string  `json:"authorId,omitempty"`
	AuthorName string  `json:"authorName,omitempty"`
	Text       string  `json:"text,omitempty"`
	URL        string  `json:"url,omitempty"`
	Label      string  `json:"label,omitempty"`
	CreatedAt  string  `json:"createdAt,omitempty"`
}

type Object struct {
	ID           string       `json:"id"`
	Type         string       `json:"type"`
	X            float64      `json:"x"`
	Y            float64      `json:"y"`
	W            float64      `json:"w"`
	H            float64      `json:"h"`
	Rotation     float64      `json:"rotation"`
	Z            string       `json:"z"`
	Fill         string       `json:"fill"`
	Stroke       string       `json:"stroke"`
	StrokeWidth  float64      `json:"strokeWidth"`
	Points       []float64    `json:"points,omitempty"`
	Text         string       `json:"text,omitempty"`
	Attachments  []Attachment `json:"attachments,omitempty"`
	ParentID     string       `json:"parentId,omitempty"`
	FromID       string       `json:"fromId,omitempty"`
	ToID         string       `json:"toId,omitempty"`
	FromSide     string       `json:"fromSide,omitempty"`
	ToSide       string       `json:"toSide,omitempty"`
	FromOffset   *float64     `json:"fromOffset,omitempty"`
	ToOffset     *float64     `json:"toOffset,omitempty"`
	Dir          string       `json:"dir,omitempty"`
	Src          string       `json:"src,omitempty"`
	CornerRadius float64      `json:"cornerRadius,omitempty"`
	FontFamily   string       `json:"fontFamily,omitempty"`
	FontSize     float64      `json:"fontSize,omitempty"`
	Bold         bool         `json:"bold,omitempty"`
	Italic       bool         `json:"italic,omitempty"`
	TextAlign    string       `json:"textAlign,omitempty"`
}

type Document struct {
	Rev     uint64            `json:"rev"`
	Objects map[string]Object `json:"objects"`
}

func NewDocument() Document {
	return Document{Rev: 0, Objects: map[string]Object{}}
}

type ChatMessage struct {
	ID         string `json:"id"`
	AuthorID   string `json:"authorId"`
	AuthorName string `json:"authorName"`
	Color      string `json:"color"`
	Text       string `json:"text"`
	CreatedAt  string `json:"createdAt"`
}

type ChatLog struct {
	Messages []ChatMessage `json:"messages"`
}

func NewChatLog() ChatLog {
	return ChatLog{Messages: []ChatMessage{}}
}

type Op struct {
	ID       string          `json:"id"`
	Type     string          `json:"type"`
	ObjectID string          `json:"objectId"`
	Path     string          `json:"path,omitempty"`
	Value    json.RawMessage `json:"value,omitempty"`
	ActorID  string          `json:"actorId"`
	Seq      uint64          `json:"seq,omitempty"`
}

type Session struct {
	SessionID string `json:"sessionId"`
	UserID    string `json:"userId"`
	Name      string `json:"name"`
	Color     string `json:"color"`
}

type SnapshotInfo struct {
	Timestamp int64    `json:"timestamp"`
	Files     []string `json:"files"`
}

var UserColors = []string{
	"#1e2a4a", "#10b981", "#f43f5e", "#0ea5e9",
	"#8b5cf6", "#f59e0b", "#14b8a6",
}

func NextUserColor(users []User) string {
	used := map[string]int{}
	for _, u := range users {
		used[u.Color]++
	}
	best := UserColors[0]
	bestN := used[best]
	for _, c := range UserColors[1:] {
		if used[c] < bestN {
			best = c
			bestN = used[c]
		}
	}
	return best
}

func FindUserByName(users []User, name string) *User {
	want := strings.TrimSpace(strings.ToLower(name))
	for i := range users {
		if strings.ToLower(users[i].Name) == want {
			return &users[i]
		}
	}
	return nil
}

func FindUserByID(users []User, id string) *User {
	for i := range users {
		if users[i].ID == id {
			return &users[i]
		}
	}
	return nil
}

func NextZ(objects map[string]Object) string {
	n := 0
	for _, o := range objects {
		if v, ok := parseZ(o.Z); ok && v >= n {
			n = v + 1
		}
	}
	return fmt.Sprintf("a%d", n)
}

func ParseZ(z string) int {
	v, _ := parseZ(z)
	return v
}

func parseZ(z string) (int, bool) {
	if strings.HasPrefix(z, "a") {
		v, err := strconv.Atoi(z[1:])
		if err == nil {
			return v, true
		}
	}
	return 0, false
}

func SortedObjects(objects map[string]Object) []Object {
	out := make([]Object, 0, len(objects))
	for _, o := range objects {
		out = append(out, o)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Z == out[j].Z {
			return out[i].ID < out[j].ID
		}
		return out[i].Z < out[j].Z
	})
	return out
}

func (d *Document) Apply(op *Op) error {
	if d.Objects == nil {
		d.Objects = map[string]Object{}
	}
	switch op.Type {
	case "create":
		var obj Object
		if err := json.Unmarshal(op.Value, &obj); err != nil {
			return fmt.Errorf("create value: %w", err)
		}
		if obj.ID == "" {
			return fmt.Errorf("create missing id")
		}
		if obj.Z == "" {
			obj.Z = NextZ(d.Objects)
		}
		if obj.Attachments == nil {
			obj.Attachments = []Attachment{}
		}
		d.Objects[obj.ID] = obj
		op.ObjectID = obj.ID
	case "update":
		obj, ok := d.Objects[op.ObjectID]
		if !ok {
			return fmt.Errorf("unknown object %s", op.ObjectID)
		}
		if err := setPath(&obj, op.Path, op.Value); err != nil {
			return err
		}
		d.Objects[op.ObjectID] = obj
	case "delete":
		if _, ok := d.Objects[op.ObjectID]; !ok {
			return fmt.Errorf("unknown object %s", op.ObjectID)
		}
		d.cascadeDelete(op.ObjectID)
	default:
		return fmt.Errorf("unknown op type %q", op.Type)
	}
	d.Rev++
	op.Seq = d.Rev
	return nil
}

func setPath(obj *Object, path string, raw json.RawMessage) error {
	switch path {
	case "x":
		return unmarshalNum(raw, &obj.X)
	case "y":
		return unmarshalNum(raw, &obj.Y)
	case "w":
		return unmarshalNum(raw, &obj.W)
	case "h":
		return unmarshalNum(raw, &obj.H)
	case "rotation":
		return unmarshalNum(raw, &obj.Rotation)
	case "z":
		return json.Unmarshal(raw, &obj.Z)
	case "fill":
		return json.Unmarshal(raw, &obj.Fill)
	case "stroke":
		return json.Unmarshal(raw, &obj.Stroke)
	case "strokeWidth":
		return unmarshalNum(raw, &obj.StrokeWidth)
	case "points":
		return json.Unmarshal(raw, &obj.Points)
	case "text":
		return json.Unmarshal(raw, &obj.Text)
	case "attachments":
		var atts []Attachment
		if err := json.Unmarshal(raw, &atts); err != nil {
			return err
		}
		if atts == nil {
			atts = []Attachment{}
		}
		obj.Attachments = atts
	case "parentId":
		return json.Unmarshal(raw, &obj.ParentID)
	case "fromId":
		return json.Unmarshal(raw, &obj.FromID)
	case "toId":
		return json.Unmarshal(raw, &obj.ToID)
	case "fromSide":
		return json.Unmarshal(raw, &obj.FromSide)
	case "toSide":
		return json.Unmarshal(raw, &obj.ToSide)
	case "fromOffset":
		var v float64
		if err := unmarshalNum(raw, &v); err != nil {
			return err
		}
		obj.FromOffset = &v
		return nil
	case "toOffset":
		var v float64
		if err := unmarshalNum(raw, &v); err != nil {
			return err
		}
		obj.ToOffset = &v
		return nil
	case "dir":
		return json.Unmarshal(raw, &obj.Dir)
	case "src":
		return json.Unmarshal(raw, &obj.Src)
	case "fontFamily":
		return json.Unmarshal(raw, &obj.FontFamily)
	case "fontSize":
		return unmarshalNum(raw, &obj.FontSize)
	case "bold":
		return json.Unmarshal(raw, &obj.Bold)
	case "italic":
		return json.Unmarshal(raw, &obj.Italic)
	case "textAlign":
		var align string
		if err := json.Unmarshal(raw, &align); err != nil {
			return err
		}
		switch align {
		case "", "left", "center", "right":
			obj.TextAlign = align
			return nil
		default:
			return fmt.Errorf("invalid textAlign %q", align)
		}
	default:
		return fmt.Errorf("unknown path %q", path)
	}
	return nil
}

func IsContainer(typ string) bool {
	return typ == "group" || typ == "frame" || typ == "lane"
}

func (d *Document) cascadeDelete(id string) {
	obj := d.Objects[id]
	keepChildren := IsContainer(obj.Type)
	delete(d.Objects, id)
	for oid, o := range d.Objects {
		if o.ParentID == id && keepChildren {
			o.ParentID = ""
			d.Objects[oid] = o
			continue
		}
		if o.Type == "connector" && (o.FromID == id || o.ToID == id) {
			delete(d.Objects, oid)
		}
	}
}

func unmarshalNum(raw json.RawMessage, dest *float64) error {
	var n float64
	if err := json.Unmarshal(raw, &n); err != nil {
		return err
	}
	*dest = n
	return nil
}
