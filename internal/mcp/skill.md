---
name: draw-with-liro
description: Draw and arrange shapes on a Liro collaborative whiteboard through MCP tools. Use when creating, reading, viewing, or editing Liro boards, or when the user asks an agent to sketch, diagram, or lay out ideas on a board.
---

# Draw with Liro

Call this skill (the `instructions` tool) before creating or editing shapes.

## Workflow

1. `list_boards` or `create_board` (list skips archived boards)
2. `join_board` with a stable display name (you become a collaborator). If the board is password-protected, pass `password`.
3. `view_board` to see what is already there (same optional `password`)
4. Plan coordinates, then `create_objects` in one batch
5. `view_board` again
6. `align` / `distribute` / `update_objects` / `connect_objects` as needed

Always `join_board` before any mutation. Mutating tools require the returned `userId`. After every create batch, `view_board` before more edits. Archived boards are hidden from `list_boards` and cannot be joined until restored in the UI.

## Canvas

- Origin is top-left. +x is right, +y is down. Units are pixels.
- Start layouts in `(80, 80)` to `(1400, 900)`. Leave 24–40px gaps.
- Prefer `align` and `distribute` over hand-nudging x/y.
- Layer order is a `z` string (`a0`, `a1`, …). The server assigns it if omitted.
- After drawing, call `view_board` and fix overlaps.

## Object types

| Type | Default size | Notes |
|---|---|---|
| `rect` | 160×100 | fill `#93c5fd`, stroke `#1e2a4a` |
| `roundrect` | 160×100 | same paints; `cornerRadius` defaults to 16 |
| `ellipse` | 160×100 | same paints |
| `triangle` / `diamond` / `arrow` | 160×120 | polygon `points` filled in for you |
| `hexagon` / `parallelogram` / `cylinder` | 160×120 | flowchart shapes; cylinder is a standing side-elevation silhouette |
| `postit` | 180×160 | yellow note; put copy in `text` |
| `text` | 240×48 | ink fill, `fontSize` 20; put copy in `text` |
| `sticker` | 64×64 | emoji object; put the emoji glyph in `text`; size tracks `w`/`h` |
| `line` | 160 wide | `points` are `[0,0,dx,dy]` relative to x/y |
| `spline` | — | freeform `points` relative to x/y |
| `frame` | 480×320 | container; children use `parentId` |
| `lane` | 240×180 | `dir` is `h` or `v`; can nest in a frame |
| `group` | around children | prefer `group_objects` |
| `connector` | — | prefer `connect_objects`; orthogonal elbows between sides |

`create_objects` needs `type` plus `x`/`y`. Omit `w`/`h` to use defaults. Optional: `text`, `fill`, `stroke`, `strokeWidth`, `cornerRadius`, `points`, `parentId`, `dir`, `fontSize`, `bold`, `italic`, `textAlign`, `rotation`.

## Hierarchy

- Frames, lanes, and groups are containers. Set `parentId` to nest.
- Deleting a container unparents children (they stay on the board).
- Deleting an endpoint deletes its connectors.
- `group_objects` wraps targets in a group. `ungroup_objects` deletes selected groups and frees children.

## Layout tools

- `align`: `left` `center` `right` `top` `middle` `bottom` (needs ≥2 ids)
- `distribute`: `x` or `y` (needs ≥3 ids)
- `reorder`: `front` `back` `forward` `backward`

Connectors are orthogonal (right-angle) elbows between shape side anchors. Optional `fromSide`/`toSide` pin attachment sides; offsets default to mid-side. Connectors are ignored as align/distribute targets.

## Viewing

- `read_board` returns the full object map.
- `view_board` returns a compact scene (AABB, type, text, parent, z) plus SVG. Use it to check spacing and overlaps.
