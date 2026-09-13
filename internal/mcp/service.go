package liromcp

import (
	"encoding/json"
	"fmt"
	"strings"

	"liro/internal/auth"
	"liro/internal/draw"
	"liro/internal/hub"
	"liro/internal/id"
	"liro/internal/layout"
	"liro/internal/model"
	"liro/internal/store"
)

type Service struct {
	Store *store.Store
	Hubs  *hub.Registry
}

func NewService(st *store.Store, hubs *hub.Registry) *Service {
	return &Service{Store: st, Hubs: hubs}
}

func (s *Service) ListBoards() ([]model.Meta, error) {
	return s.Store.List(false)
}

func (s *Service) CreateBoard(name string) (model.Meta, error) {
	rec, err := s.Store.Create(name)
	if err != nil {
		return model.Meta{}, err
	}
	var meta model.Meta
	rec.WithLock(func() { meta = rec.Meta })
	return meta, nil
}

type BoardRead struct {
	Meta    model.PublicMeta        `json:"meta"`
	Rev     uint64                  `json:"rev"`
	Objects map[string]model.Object `json:"objects"`
}

func (s *Service) ReadBoard(boardID, password string) (BoardRead, error) {
	meta, doc, err := s.accessBoard(boardID, password)
	if err != nil {
		return BoardRead{}, err
	}
	return BoardRead{Meta: meta.Public(), Rev: doc.Rev, Objects: doc.Objects}, nil
}

type BoardView struct {
	BoardID string           `json:"boardId"`
	Name    string           `json:"name"`
	Rev     uint64           `json:"rev"`
	Scene   []draw.SceneItem `json:"scene"`
	SVG     string           `json:"svg"`
}

func (s *Service) ViewBoard(boardID, password string) (BoardView, error) {
	meta, doc, err := s.accessBoard(boardID, password)
	if err != nil {
		return BoardView{}, err
	}
	return BoardView{
		BoardID: meta.ID,
		Name:    meta.Name,
		Rev:     doc.Rev,
		Scene:   draw.Scene(doc.Objects),
		SVG:     draw.SVG(doc.Objects),
	}, nil
}

type JoinResult struct {
	UserID  string `json:"userId"`
	Name    string `json:"name"`
	Color   string `json:"color"`
	Created bool   `json:"created"`
}

func (s *Service) JoinBoard(boardID, name, password string) (JoinResult, error) {
	rec, err := s.Store.Get(boardID)
	if err != nil {
		return JoinResult{}, err
	}
	var meta model.Meta
	rec.WithLock(func() { meta = rec.Meta })
	if meta.IsArchived() {
		return JoinResult{}, fmt.Errorf("board is archived")
	}
	if err := auth.CheckPassword(meta.PasswordHash, password); err != nil {
		return JoinResult{}, fmt.Errorf("incorrect password")
	}
	var (
		user    model.User
		created bool
	)
	rec.WithLock(func() {
		user, created, err = rec.AddUser(name)
	})
	if err != nil {
		return JoinResult{}, err
	}
	if err := s.Hubs.TouchAgent(boardID, user); err != nil {
		return JoinResult{}, err
	}
	return JoinResult{UserID: user.ID, Name: user.Name, Color: user.Color, Created: created}, nil
}

func (s *Service) CreateObjects(boardID, userID string, specs []ObjectSpec) ([]model.Object, error) {
	if _, err := s.actor(boardID, userID); err != nil {
		return nil, err
	}
	_, doc, err := s.snapshot(boardID)
	if err != nil {
		return nil, err
	}
	objs := copyObjects(doc.Objects)
	created := make([]model.Object, 0, len(specs))
	ops := make([]model.Op, 0, len(specs))
	for _, spec := range specs {
		obj, err := draw.Build(spec.toDraw(), objs)
		if err != nil {
			return nil, err
		}
		objs[obj.ID] = obj
		created = append(created, obj)
		ops = append(ops, createOp(obj))
	}
	if _, err := s.Hubs.Apply(boardID, userID, ops); err != nil {
		return nil, err
	}
	return created, nil
}

func (s *Service) UpdateObjects(boardID, userID string, patches []ObjectPatch) error {
	if _, err := s.actor(boardID, userID); err != nil {
		return err
	}
	_, doc, err := s.snapshot(boardID)
	if err != nil {
		return err
	}
	ops := make([]model.Op, 0)
	for _, p := range patches {
		if strings.TrimSpace(p.ID) == "" {
			return fmt.Errorf("patch missing id")
		}
		if _, ok := doc.Objects[p.ID]; !ok {
			return fmt.Errorf("unknown object %s", p.ID)
		}
		for path, val := range p.Fields {
			if !allowedPath[path] {
				return fmt.Errorf("unknown path %q", path)
			}
			raw, err := json.Marshal(val)
			if err != nil {
				return err
			}
			ops = append(ops, model.Op{Type: "update", ObjectID: p.ID, Path: path, Value: raw})
		}
	}
	_, err = s.Hubs.Apply(boardID, userID, ops)
	return err
}

func (s *Service) DeleteObjects(boardID, userID string, ids []string) error {
	if _, err := s.actor(boardID, userID); err != nil {
		return err
	}
	ops := make([]model.Op, 0, len(ids))
	for _, oid := range ids {
		ops = append(ops, model.Op{Type: "delete", ObjectID: oid})
	}
	_, err := s.Hubs.Apply(boardID, userID, ops)
	return err
}

func (s *Service) Align(boardID, userID string, ids []string, kind string) error {
	if _, err := s.actor(boardID, userID); err != nil {
		return err
	}
	_, doc, err := s.snapshot(boardID)
	if err != nil {
		return err
	}
	k := layout.Align(kind)
	switch k {
	case layout.AlignLeft, layout.AlignCenter, layout.AlignRight, layout.AlignTop, layout.AlignMiddle, layout.AlignBottom:
	default:
		return fmt.Errorf("unknown align kind %q", kind)
	}
	return s.applyPatches(boardID, userID, layout.AlignPatches(k, ids, doc.Objects))
}

func (s *Service) Distribute(boardID, userID string, ids []string, axis string) error {
	if _, err := s.actor(boardID, userID); err != nil {
		return err
	}
	if axis != "x" && axis != "y" {
		return fmt.Errorf("axis must be x or y")
	}
	_, doc, err := s.snapshot(boardID)
	if err != nil {
		return err
	}
	return s.applyPatches(boardID, userID, layout.DistributePatches(axis, ids, doc.Objects))
}

func (s *Service) Reorder(boardID, userID string, ids []string, action string) error {
	if _, err := s.actor(boardID, userID); err != nil {
		return err
	}
	switch action {
	case "front", "back", "forward", "backward":
	default:
		return fmt.Errorf("unknown reorder action %q", action)
	}
	_, doc, err := s.snapshot(boardID)
	if err != nil {
		return err
	}
	return s.applyPatches(boardID, userID, layout.ZPatches(action, ids, doc.Objects))
}

func (s *Service) GroupObjects(boardID, userID string, ids []string) (model.Object, error) {
	if _, err := s.actor(boardID, userID); err != nil {
		return model.Object{}, err
	}
	_, doc, err := s.snapshot(boardID)
	if err != nil {
		return model.Object{}, err
	}
	members := layout.Targets(ids, doc.Objects)
	if len(members) < 2 {
		return model.Object{}, fmt.Errorf("group needs at least 2 objects")
	}
	group, err := draw.GroupAround(members, doc.Objects)
	if err != nil {
		return model.Object{}, err
	}
	ops := []model.Op{createOp(group)}
	for _, m := range members {
		raw, _ := json.Marshal(group.ID)
		ops = append(ops, model.Op{Type: "update", ObjectID: m.ID, Path: "parentId", Value: raw})
	}
	if _, err := s.Hubs.Apply(boardID, userID, ops); err != nil {
		return model.Object{}, err
	}
	return group, nil
}

func (s *Service) UngroupObjects(boardID, userID string, ids []string) error {
	if _, err := s.actor(boardID, userID); err != nil {
		return err
	}
	_, doc, err := s.snapshot(boardID)
	if err != nil {
		return err
	}
	ops := []model.Op{}
	for _, oid := range ids {
		o, ok := doc.Objects[oid]
		if !ok || o.Type != "group" {
			continue
		}
		ops = append(ops, model.Op{Type: "delete", ObjectID: oid})
	}
	if len(ops) == 0 {
		return fmt.Errorf("no groups in selection")
	}
	_, err = s.Hubs.Apply(boardID, userID, ops)
	return err
}

func (s *Service) ConnectObjects(boardID, userID, fromID, toID, fromSide, toSide string) (model.Object, error) {
	if _, err := s.actor(boardID, userID); err != nil {
		return model.Object{}, err
	}
	_, doc, err := s.snapshot(boardID)
	if err != nil {
		return model.Object{}, err
	}
	from, ok1 := doc.Objects[fromID]
	to, ok2 := doc.Objects[toID]
	if !ok1 || !ok2 {
		return model.Object{}, fmt.Errorf("unknown endpoint")
	}
	conn, err := draw.Connect(from, to, fromSide, toSide, doc.Objects)
	if err != nil {
		return model.Object{}, err
	}
	if _, err := s.Hubs.Apply(boardID, userID, []model.Op{createOp(conn)}); err != nil {
		return model.Object{}, err
	}
	return conn, nil
}

func (s *Service) applyPatches(boardID, userID string, patches []layout.Patch) error {
	ops := make([]model.Op, 0, len(patches))
	for _, p := range patches {
		raw, err := json.Marshal(p.Value)
		if err != nil {
			return err
		}
		ops = append(ops, model.Op{Type: "update", ObjectID: p.ID, Path: p.Path, Value: raw})
	}
	_, err := s.Hubs.Apply(boardID, userID, ops)
	return err
}

func (s *Service) actor(boardID, userID string) (model.User, error) {
	if strings.TrimSpace(userID) == "" {
		return model.User{}, fmt.Errorf("userId required: join the board first")
	}
	rec, err := s.Store.Get(boardID)
	if err != nil {
		return model.User{}, err
	}
	var user *model.User
	rec.WithLock(func() {
		user = model.FindUserByID(rec.Meta.Users, userID)
	})
	if user == nil {
		return model.User{}, fmt.Errorf("unknown user: join the board first")
	}
	if err := s.Hubs.TouchAgent(boardID, *user); err != nil {
		return model.User{}, err
	}
	return *user, nil
}

func (s *Service) snapshot(boardID string) (model.Meta, model.Document, error) {
	rec, err := s.Store.Get(boardID)
	if err != nil {
		return model.Meta{}, model.Document{}, err
	}
	var meta model.Meta
	var doc model.Document
	rec.WithLock(func() {
		meta = rec.Meta
		meta.Users = append([]model.User(nil), rec.Meta.Users...)
		doc.Rev = rec.Document.Rev
		doc.Objects = copyObjects(rec.Document.Objects)
	})
	meta.PasswordHash = ""
	return meta, doc, nil
}

func (s *Service) accessBoard(boardID, password string) (model.Meta, model.Document, error) {
	rec, err := s.Store.Get(boardID)
	if err != nil {
		return model.Meta{}, model.Document{}, err
	}
	var meta model.Meta
	var doc model.Document
	var hash string
	rec.WithLock(func() {
		meta = rec.Meta
		hash = rec.Meta.PasswordHash
		meta.Users = append([]model.User(nil), rec.Meta.Users...)
		doc.Rev = rec.Document.Rev
		doc.Objects = copyObjects(rec.Document.Objects)
	})
	if meta.IsArchived() {
		return model.Meta{}, model.Document{}, fmt.Errorf("board is archived")
	}
	if err := auth.CheckPassword(hash, password); err != nil {
		return model.Meta{}, model.Document{}, fmt.Errorf("incorrect password")
	}
	meta.PasswordHash = ""
	return meta, doc, nil
}

func copyObjects(in map[string]model.Object) map[string]model.Object {
	out := make(map[string]model.Object, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

func createOp(obj model.Object) model.Op {
	raw, _ := json.Marshal(obj)
	return model.Op{ID: id.New("op"), Type: "create", ObjectID: obj.ID, Value: raw}
}

var allowedPath = map[string]bool{
	"x": true, "y": true, "w": true, "h": true, "rotation": true, "z": true,
	"fill": true, "stroke": true, "strokeWidth": true, "points": true, "text": true,
	"attachments": true, "parentId": true, "fromId": true, "toId": true,
	"fromSide": true, "toSide": true, "fromOffset": true, "toOffset": true, "dir": true, "src": true,
	"fontFamily": true, "fontSize": true, "bold": true, "italic": true, "textAlign": true,
}
