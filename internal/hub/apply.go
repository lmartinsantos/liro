package hub

import (
	"fmt"
	"time"

	"liro/internal/id"
	"liro/internal/model"
	"liro/internal/store"
)

func agentSessionID(userID string) string {
	return "ses_agent_" + userID
}

// Apply persists ops as actorID and broadcasts them to any live room.
func (reg *Registry) Apply(boardID, actorID string, ops []model.Op) ([]model.Op, error) {
	if actorID == "" {
		return nil, fmt.Errorf("userId required: join the board first")
	}
	rec, err := reg.store.Get(boardID)
	if err != nil {
		return nil, err
	}
	var user *model.User
	rec.WithLock(func() {
		user = model.FindUserByID(rec.Meta.Users, actorID)
	})
	if user == nil {
		return nil, fmt.Errorf("unknown user: join the board first")
	}

	applied := make([]model.Op, 0, len(ops))
	rec.WithLock(func() {
		for i := range ops {
			op := ops[i]
			op.ActorID = actorID
			if op.ID == "" {
				op.ID = id.New("op")
			}
			if err = rec.Document.Apply(&op); err != nil {
				return
			}
			rec.MarkDirty(store.FileBoard)
			applied = append(applied, op)
		}
	})
	if err != nil {
		return applied, err
	}

	reg.mu.Lock()
	room := reg.rooms[boardID]
	reg.mu.Unlock()
	if room != nil {
		for i := range applied {
			op := applied[i]
			room.broadcast(Envelope{Type: "op", Op: &op}, "")
		}
	}
	return applied, nil
}

// TouchAgent keeps a synthetic presence session so the agent appears in the board header.
func (reg *Registry) TouchAgent(boardID string, user model.User) error {
	if user.ID == "" {
		return fmt.Errorf("userId required: join the board first")
	}
	rec, err := reg.store.Get(boardID)
	if err != nil {
		return err
	}
	var found *model.User
	rec.WithLock(func() {
		found = model.FindUserByID(rec.Meta.Users, user.ID)
	})
	if found == nil {
		return fmt.Errorf("unknown user: join the board first")
	}
	user = *found

	room := reg.ensureRoom(boardID, rec)
	sessionID := agentSessionID(user.ID)
	now := time.Now()

	room.mu.Lock()
	if cl, ok := room.clients[sessionID]; ok {
		cl.seen = now
		room.mu.Unlock()
		return nil
	}
	cl := &Client{
		ID: sessionID,
		Session: model.Session{
			SessionID: sessionID,
			UserID:    user.ID,
			Name:      user.Name,
			Color:     user.Color,
		},
		Send:  make(chan []byte, 64),
		agent: true,
		seen:  now,
	}
	room.clients[sessionID] = cl
	room.mu.Unlock()

	go drainAgent(cl)
	go reg.evictAgentLater(boardID, sessionID)
	room.broadcastPresence()
	return nil
}

func drainAgent(cl *Client) {
	for range cl.Send {
	}
}

func (reg *Registry) evictAgentLater(boardID, clientID string) {
	for {
		time.Sleep(AgentIdle)
		reg.mu.Lock()
		room, ok := reg.rooms[boardID]
		reg.mu.Unlock()
		if !ok {
			return
		}
		room.mu.Lock()
		cl, exists := room.clients[clientID]
		if !exists || !cl.agent {
			room.mu.Unlock()
			return
		}
		if time.Since(cl.seen) < AgentIdle {
			room.mu.Unlock()
			continue
		}
		safeClose(cl.Send)
		delete(room.clients, clientID)
		empty := len(room.clients) == 0
		room.mu.Unlock()
		if empty {
			go reg.evictLater(boardID)
		} else {
			room.broadcastPresence()
		}
		return
	}
}
