package hub

import (
	"encoding/json"
	"log"
	"sync"
	"time"

	"liro/internal/id"
	"liro/internal/model"
	"liro/internal/store"
)

const EvictAfter = 30 * time.Second

// AgentIdle is how long a synthetic MCP presence session stays after the last touch.
var AgentIdle = 2 * time.Minute

type Envelope struct {
	Type      string             `json:"type"`
	Op        *model.Op          `json:"op,omitempty"`
	X         float64            `json:"x,omitempty"`
	Y         float64            `json:"y,omitempty"`
	Text      string             `json:"text,omitempty"`
	Message   *model.ChatMessage `json:"message,omitempty"`
	Document  *model.Document    `json:"document,omitempty"`
	Chat      *model.ChatLog     `json:"chat,omitempty"`
	Meta      *model.PublicMeta  `json:"meta,omitempty"`
	Presence  []model.Session    `json:"presence,omitempty"`
	SessionID string             `json:"sessionId,omitempty"`
	UserID    string             `json:"userId,omitempty"`
	Name      string             `json:"name,omitempty"`
	Color     string             `json:"color,omitempty"`
	Error     string             `json:"error,omitempty"`
}

type Client struct {
	ID      string
	Session model.Session
	Send    chan []byte
	agent   bool
	seen    time.Time
}

type inbound struct {
	client *Client
	msg    Envelope
}

type Room struct {
	id      string
	rec     *store.BoardRecord
	store   *store.Store
	mu      sync.Mutex
	clients map[string]*Client
	inbox   chan inbound
	quit    chan struct{}
}

type Registry struct {
	store *store.Store
	mu    sync.Mutex
	rooms map[string]*Room
}

func NewRegistry(st *store.Store) *Registry {
	return &Registry{store: st, rooms: map[string]*Room{}}
}

func (reg *Registry) Join(boardID string, session model.Session) (*Room, *Client, error) {
	rec, err := reg.store.Get(boardID)
	if err != nil {
		return nil, nil, err
	}
	user := model.FindUserByID(func() []model.User {
		var users []model.User
		rec.WithLock(func() { users = append([]model.User(nil), rec.Meta.Users...) })
		return users
	}(), session.UserID)
	if user == nil {
		return nil, nil, errUnknownUser
	}
	session.Name = user.Name
	session.Color = user.Color
	if session.SessionID == "" {
		session.SessionID = id.New("ses")
	}

	room := reg.ensureRoom(boardID, rec)

	cl := &Client{
		ID:      session.SessionID,
		Session: session,
		Send:    make(chan []byte, 64),
	}
	room.mu.Lock()
	room.clients[cl.ID] = cl
	room.mu.Unlock()
	room.sendState(cl)
	room.broadcastPresence()
	return room, cl, nil
}

var errUnknownUser = errString("unknown user")

type errString string

func (e errString) Error() string { return string(e) }

func (reg *Registry) leave(boardID, clientID string) {
	reg.mu.Lock()
	room, ok := reg.rooms[boardID]
	reg.mu.Unlock()
	if !ok {
		return
	}
	room.mu.Lock()
	if cl, exists := room.clients[clientID]; exists {
		safeClose(cl.Send)
		delete(room.clients, clientID)
	}
	empty := len(room.clients) == 0
	room.mu.Unlock()
	if empty {
		go reg.evictLater(boardID)
	} else {
		room.broadcastPresence()
	}
}

func (reg *Registry) evictLater(boardID string) {
	time.Sleep(EvictAfter)
	reg.mu.Lock()
	room, ok := reg.rooms[boardID]
	if !ok {
		reg.mu.Unlock()
		return
	}
	room.mu.Lock()
	empty := len(room.clients) == 0
	room.mu.Unlock()
	if !empty {
		reg.mu.Unlock()
		return
	}
	delete(reg.rooms, boardID)
	close(room.quit)
	reg.mu.Unlock()
	reg.store.Unload(boardID)
}

func (reg *Registry) Close() {
	reg.mu.Lock()
	rooms := reg.rooms
	reg.rooms = map[string]*Room{}
	reg.mu.Unlock()
	for _, room := range rooms {
		close(room.quit)
		room.mu.Lock()
		for _, cl := range room.clients {
			safeClose(cl.Send)
		}
		room.clients = map[string]*Client{}
		room.mu.Unlock()
	}
}

func (reg *Registry) ensureRoom(boardID string, rec *store.BoardRecord) *Room {
	reg.mu.Lock()
	defer reg.mu.Unlock()
	if room, ok := reg.rooms[boardID]; ok {
		return room
	}
	room := &Room{
		id:      boardID,
		rec:     rec,
		store:   reg.store,
		clients: map[string]*Client{},
		inbox:   make(chan inbound, 128),
		quit:    make(chan struct{}),
	}
	reg.rooms[boardID] = room
	go room.loop()
	return room
}

func safeClose(ch chan []byte) {
	defer func() { _ = recover() }()
	close(ch)
}

func (reg *Registry) Leave(boardID, clientID string) {
	reg.leave(boardID, clientID)
}

// Drop closes a room immediately and unloads the board (used before permanent delete).
func (reg *Registry) Drop(boardID string) {
	reg.mu.Lock()
	room, ok := reg.rooms[boardID]
	if ok {
		delete(reg.rooms, boardID)
	}
	reg.mu.Unlock()
	if !ok {
		reg.store.Unload(boardID)
		return
	}
	close(room.quit)
	room.mu.Lock()
	for _, cl := range room.clients {
		safeClose(cl.Send)
	}
	room.clients = map[string]*Client{}
	room.mu.Unlock()
	reg.store.Unload(boardID)
}

// BroadcastState pushes a full board state envelope to every client in the room.
func (reg *Registry) BroadcastState(boardID string) {
	reg.mu.Lock()
	room, ok := reg.rooms[boardID]
	reg.mu.Unlock()
	if !ok {
		return
	}
	room.mu.Lock()
	clients := make([]*Client, 0, len(room.clients))
	for _, cl := range room.clients {
		clients = append(clients, cl)
	}
	room.mu.Unlock()
	for _, cl := range clients {
		room.sendState(cl)
	}
}

func (r *Room) Submit(cl *Client, msg Envelope) {
	select {
	case r.inbox <- inbound{client: cl, msg: msg}:
	case <-r.quit:
	}
}

func (r *Room) loop() {
	for {
		select {
		case <-r.quit:
			return
		case in := <-r.inbox:
			r.handle(in)
		}
	}
}

func (r *Room) handle(in inbound) {
	switch in.msg.Type {
	case "op":
		if in.msg.Op == nil {
			r.sendErr(in.client, "missing op")
			return
		}
		op := *in.msg.Op
		op.ActorID = in.client.Session.UserID
		var applied model.Op
		var applyErr error
		r.rec.WithLock(func() {
			applyErr = r.rec.Document.Apply(&op)
			if applyErr == nil {
				r.rec.MarkDirty(store.FileBoard)
				applied = op
			}
		})
		if applyErr != nil {
			r.sendErr(in.client, applyErr.Error())
			return
		}
		r.broadcast(Envelope{Type: "op", Op: &applied}, "")
	case "cursor":
		r.broadcast(Envelope{
			Type:      "cursor",
			SessionID: in.client.Session.SessionID,
			UserID:    in.client.Session.UserID,
			Name:      in.client.Session.Name,
			Color:     in.client.Session.Color,
			X:         in.msg.X,
			Y:         in.msg.Y,
		}, in.client.ID)
	case "chat":
		text := trimChat(in.msg.Text)
		if text == "" {
			return
		}
		msg := model.ChatMessage{
			ID:         id.New("msg"),
			AuthorID:   in.client.Session.UserID,
			AuthorName: in.client.Session.Name,
			Color:      in.client.Session.Color,
			Text:       text,
			CreatedAt:  time.Now().UTC().Format(time.RFC3339),
		}
		r.rec.WithLock(func() {
			r.rec.Chat.Messages = append(r.rec.Chat.Messages, msg)
			r.rec.MarkDirty(store.FileChat)
		})
		r.broadcast(Envelope{Type: "chat", Message: &msg}, "")
	}
}

func trimChat(s string) string {
	if len(s) > 2000 {
		s = s[:2000]
	}
	// keep simple; API layer already validated user
	out := make([]rune, 0, len(s))
	for _, r := range s {
		if r == 0 {
			continue
		}
		out = append(out, r)
	}
	res := string(out)
	for len(res) > 0 && (res[0] == ' ' || res[0] == '\n' || res[0] == '\t') {
		res = res[1:]
	}
	for len(res) > 0 && (res[len(res)-1] == ' ' || res[len(res)-1] == '\n' || res[len(res)-1] == '\t') {
		res = res[:len(res)-1]
	}
	return res
}

func (r *Room) sendState(cl *Client) {
	var env Envelope
	r.rec.WithLock(func() {
		doc := r.rec.Document
		objs := make(map[string]model.Object, len(doc.Objects))
		for k, v := range doc.Objects {
			objs[k] = v
		}
		doc.Objects = objs
		chat := r.rec.Chat
		msgs := append([]model.ChatMessage(nil), chat.Messages...)
		chat.Messages = msgs
		meta := r.rec.Meta.Public()
		env = Envelope{
			Type:     "state",
			Document: &doc,
			Chat:     &chat,
			Meta:     &meta,
			Presence: r.presenceLocked(),
		}
	})
	r.send(cl, env)
}

func (r *Room) presence() []model.Session {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.presenceLocked()
}

func (r *Room) presenceLocked() []model.Session {
	out := make([]model.Session, 0, len(r.clients))
	for _, c := range r.clients {
		out = append(out, c.Session)
	}
	return out
}

func (r *Room) broadcastPresence() {
	r.broadcast(Envelope{Type: "presence", Presence: r.presence()}, "")
}

func (r *Room) sendErr(cl *Client, msg string) {
	r.send(cl, Envelope{Type: "error", Error: msg})
}

func (r *Room) send(cl *Client, env Envelope) {
	data, err := json.Marshal(env)
	if err != nil {
		log.Println("marshal:", err)
		return
	}
	select {
	case cl.Send <- data:
	default:
	}
}

func (r *Room) broadcast(env Envelope, except string) {
	data, err := json.Marshal(env)
	if err != nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	for id, cl := range r.clients {
		if id == except {
			continue
		}
		select {
		case cl.Send <- data:
		default:
		}
	}
}
