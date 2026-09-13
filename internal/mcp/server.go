package liromcp

import (
	"context"
	_ "embed"
	"net/http"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"liro/internal/hub"
	"liro/internal/store"
)

//go:embed skill.md
var Skill string

const serverInstructions = "Liro is a collaborative whiteboard. Call the instructions tool before creating or editing shapes. Join a board as a collaborator, then draw, view, and align."

func NewServer(st *store.Store, hubs *hub.Registry) *mcp.Server {
	svc := NewService(st, hubs)
	server := mcp.NewServer(&mcp.Implementation{Name: "liro", Version: "v1.0.0"}, &mcp.ServerOptions{
		Instructions: serverInstructions,
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "instructions",
		Description: "Returns the draw-with-liro skill. Call this before creating or editing shapes.",
	}, svc.instructions)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "list_boards",
		Description: "List active (non-archived) Liro boards (id, name, users, createdAt).",
	}, svc.listBoards)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "create_board",
		Description: "Create a new empty board.",
	}, svc.createBoard)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "read_board",
		Description: "Read board meta, revision, and the full object map. Pass password when the board is protected.",
	}, svc.readBoard)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "view_board",
		Description: "View a compact scene (AABB, type, text, z) plus an SVG of the board. Pass password when protected.",
	}, svc.viewBoard)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "join_board",
		Description: "Register as a collaborator on a board. Required before any mutation. Reuses an existing user when the name already exists. Pass password when the board is protected.",
	}, svc.joinBoard)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "create_objects",
		Description: "Create one or more shapes. Requires userId from join_board. Omit w/h to use defaults.",
	}, svc.createObjects)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "update_objects",
		Description: "Patch object fields (x, y, w, h, text, fill, stroke, parentId, and other document paths).",
	}, svc.updateObjects)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "delete_objects",
		Description: "Delete objects by id. Container delete unparents children; endpoint delete removes connectors.",
	}, svc.deleteObjects)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "align",
		Description: "Align objects: left, center, right, top, middle, or bottom. Needs at least two ids.",
	}, svc.align)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "distribute",
		Description: "Evenly distribute objects along x or y. Needs at least three ids.",
	}, svc.distribute)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "reorder",
		Description: "Change z-order: front, back, forward, or backward.",
	}, svc.reorder)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "group_objects",
		Description: "Wrap objects in a group container and set their parentId.",
	}, svc.groupObjects)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "ungroup_objects",
		Description: "Delete selected groups and free their children.",
	}, svc.ungroupObjects)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "connect_objects",
		Description: "Draw a connector between two objects. Sides are chosen automatically if omitted.",
	}, svc.connectObjects)

	return server
}

func Handler(st *store.Store, hubs *hub.Registry) http.Handler {
	server := NewServer(st, hubs)
	return mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server {
		return server
	}, &mcp.StreamableHTTPOptions{Stateless: true})
}

type empty struct{}

type instructionsOut struct {
	Skill string `json:"skill"`
}

func (s *Service) instructions(_ context.Context, _ *mcp.CallToolRequest, _ empty) (*mcp.CallToolResult, instructionsOut, error) {
	return &mcp.CallToolResult{
		Content: []mcp.Content{&mcp.TextContent{Text: Skill}},
	}, instructionsOut{Skill: Skill}, nil
}

type listOut struct {
	Boards []boardMeta `json:"boards"`
}

type boardMeta struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	CreatedAt string `json:"createdAt"`
	Users     int    `json:"users"`
}

func (s *Service) listBoards(_ context.Context, _ *mcp.CallToolRequest, _ empty) (*mcp.CallToolResult, listOut, error) {
	list, err := s.ListBoards()
	if err != nil {
		return nil, listOut{}, err
	}
	out := listOut{Boards: make([]boardMeta, 0, len(list))}
	for _, m := range list {
		out.Boards = append(out.Boards, boardMeta{
			ID:        m.ID,
			Name:      m.Name,
			CreatedAt: m.CreatedAt.UTC().Format("2006-01-02T15:04:05Z"),
			Users:     len(m.Users),
		})
	}
	return nil, out, nil
}

type createBoardIn struct {
	Name string `json:"name" jsonschema:"board title"`
}

func (s *Service) createBoard(_ context.Context, _ *mcp.CallToolRequest, in createBoardIn) (*mcp.CallToolResult, boardMeta, error) {
	m, err := s.CreateBoard(in.Name)
	if err != nil {
		return nil, boardMeta{}, err
	}
	return nil, boardMeta{
		ID:        m.ID,
		Name:      m.Name,
		CreatedAt: m.CreatedAt.UTC().Format("2006-01-02T15:04:05Z"),
		Users:     len(m.Users),
	}, nil
}

type boardIDIn struct {
	BoardID  string `json:"boardId" jsonschema:"board id"`
	Password string `json:"password,omitempty" jsonschema:"board password when protected"`
}

func (s *Service) readBoard(_ context.Context, _ *mcp.CallToolRequest, in boardIDIn) (*mcp.CallToolResult, BoardRead, error) {
	out, err := s.ReadBoard(in.BoardID, in.Password)
	return nil, out, err
}

func (s *Service) viewBoard(_ context.Context, _ *mcp.CallToolRequest, in boardIDIn) (*mcp.CallToolResult, BoardView, error) {
	out, err := s.ViewBoard(in.BoardID, in.Password)
	return nil, out, err
}

type joinIn struct {
	BoardID  string `json:"boardId" jsonschema:"board id"`
	Name     string `json:"name" jsonschema:"collaborator display name"`
	Password string `json:"password,omitempty" jsonschema:"board password when protected"`
}

func (s *Service) joinBoard(_ context.Context, _ *mcp.CallToolRequest, in joinIn) (*mcp.CallToolResult, JoinResult, error) {
	out, err := s.JoinBoard(in.BoardID, in.Name, in.Password)
	return nil, out, err
}

type createObjectsIn struct {
	BoardID string       `json:"boardId"`
	UserID  string       `json:"userId" jsonschema:"user id from join_board"`
	Objects []ObjectSpec `json:"objects"`
}

type createdOut struct {
	Objects []createdObj `json:"objects"`
}

type createdObj struct {
	ID   string  `json:"id"`
	Type string  `json:"type"`
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
	W    float64 `json:"w"`
	H    float64 `json:"h"`
	Text string  `json:"text,omitempty"`
}

func (s *Service) createObjects(_ context.Context, _ *mcp.CallToolRequest, in createObjectsIn) (*mcp.CallToolResult, createdOut, error) {
	objs, err := s.CreateObjects(in.BoardID, in.UserID, in.Objects)
	if err != nil {
		return nil, createdOut{}, err
	}
	out := createdOut{Objects: make([]createdObj, 0, len(objs))}
	for _, o := range objs {
		out.Objects = append(out.Objects, createdObj{
			ID: o.ID, Type: o.Type, X: o.X, Y: o.Y, W: o.W, H: o.H, Text: o.Text,
		})
	}
	return nil, out, nil
}

type updateObjectsIn struct {
	BoardID string        `json:"boardId"`
	UserID  string        `json:"userId" jsonschema:"user id from join_board"`
	Patches []ObjectPatch `json:"patches"`
}

type okOut struct {
	OK bool `json:"ok"`
}

func (s *Service) updateObjects(_ context.Context, _ *mcp.CallToolRequest, in updateObjectsIn) (*mcp.CallToolResult, okOut, error) {
	if err := s.UpdateObjects(in.BoardID, in.UserID, in.Patches); err != nil {
		return nil, okOut{}, err
	}
	return nil, okOut{OK: true}, nil
}

type idsIn struct {
	BoardID string   `json:"boardId"`
	UserID  string   `json:"userId" jsonschema:"user id from join_board"`
	IDs     []string `json:"ids"`
}

func (s *Service) deleteObjects(_ context.Context, _ *mcp.CallToolRequest, in idsIn) (*mcp.CallToolResult, okOut, error) {
	if err := s.DeleteObjects(in.BoardID, in.UserID, in.IDs); err != nil {
		return nil, okOut{}, err
	}
	return nil, okOut{OK: true}, nil
}

type alignIn struct {
	BoardID string   `json:"boardId"`
	UserID  string   `json:"userId" jsonschema:"user id from join_board"`
	IDs     []string `json:"ids"`
	Kind    string   `json:"kind" jsonschema:"left, center, right, top, middle, or bottom"`
}

func (s *Service) align(_ context.Context, _ *mcp.CallToolRequest, in alignIn) (*mcp.CallToolResult, okOut, error) {
	if err := s.Align(in.BoardID, in.UserID, in.IDs, in.Kind); err != nil {
		return nil, okOut{}, err
	}
	return nil, okOut{OK: true}, nil
}

type distributeIn struct {
	BoardID string   `json:"boardId"`
	UserID  string   `json:"userId" jsonschema:"user id from join_board"`
	IDs     []string `json:"ids"`
	Axis    string   `json:"axis" jsonschema:"x or y"`
}

func (s *Service) distribute(_ context.Context, _ *mcp.CallToolRequest, in distributeIn) (*mcp.CallToolResult, okOut, error) {
	if err := s.Distribute(in.BoardID, in.UserID, in.IDs, in.Axis); err != nil {
		return nil, okOut{}, err
	}
	return nil, okOut{OK: true}, nil
}

type reorderIn struct {
	BoardID string   `json:"boardId"`
	UserID  string   `json:"userId" jsonschema:"user id from join_board"`
	IDs     []string `json:"ids"`
	Action  string   `json:"action" jsonschema:"front, back, forward, or backward"`
}

func (s *Service) reorder(_ context.Context, _ *mcp.CallToolRequest, in reorderIn) (*mcp.CallToolResult, okOut, error) {
	if err := s.Reorder(in.BoardID, in.UserID, in.IDs, in.Action); err != nil {
		return nil, okOut{}, err
	}
	return nil, okOut{OK: true}, nil
}

func (s *Service) groupObjects(_ context.Context, _ *mcp.CallToolRequest, in idsIn) (*mcp.CallToolResult, createdObj, error) {
	g, err := s.GroupObjects(in.BoardID, in.UserID, in.IDs)
	if err != nil {
		return nil, createdObj{}, err
	}
	return nil, createdObj{ID: g.ID, Type: g.Type, X: g.X, Y: g.Y, W: g.W, H: g.H}, nil
}

func (s *Service) ungroupObjects(_ context.Context, _ *mcp.CallToolRequest, in idsIn) (*mcp.CallToolResult, okOut, error) {
	if err := s.UngroupObjects(in.BoardID, in.UserID, in.IDs); err != nil {
		return nil, okOut{}, err
	}
	return nil, okOut{OK: true}, nil
}

type connectIn struct {
	BoardID  string `json:"boardId"`
	UserID   string `json:"userId" jsonschema:"user id from join_board"`
	FromID   string `json:"fromId"`
	ToID     string `json:"toId"`
	FromSide string `json:"fromSide,omitempty" jsonschema:"top, right, bottom, or left"`
	ToSide   string `json:"toSide,omitempty" jsonschema:"top, right, bottom, or left"`
}

func (s *Service) connectObjects(_ context.Context, _ *mcp.CallToolRequest, in connectIn) (*mcp.CallToolResult, createdObj, error) {
	c, err := s.ConnectObjects(in.BoardID, in.UserID, in.FromID, in.ToID, in.FromSide, in.ToSide)
	if err != nil {
		return nil, createdObj{}, err
	}
	return nil, createdObj{ID: c.ID, Type: c.Type}, nil
}
