# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Version numbers are defined in [`VERSIONS`](VERSIONS).

## [Unreleased]

## [0.2.0] — 2026-09-13

### Added

- Undo/redo with batched multi-object actions (Ctrl/Cmd+Z, Shift+Z / Ctrl+Y)
- Snap to grid and object edges with live alignment guides (toggle in board chrome)
- Version history panel: list auto-snapshots, save now, and restore for all connected clients
- Flowchart shapes: hexagon, parallelogram, cylinder, and rounded rectangle (corner-radius handle)
- Mind map tool: click to place a root note, then click again to add connected child branches
- Read-only share URL and iframe embed snippet from the board menu (**Embed**)
- Self-contained server binary with the SPA embedded (`go:embed`); `LIRO_STATIC` still overrides when set
- GitHub Actions publishes multi-arch release binaries (linux/darwin/windows × amd64/arm64); same `VERSIONS` version replaces prior release assets

### Changed

- Toolbar nests flowchart shapes under an expandable flyout
- Cylinder redrawn as a standing side elevation

### Fixed

- Cylinder and rounded-rectangle geometry/rendering

## [0.1.0] — 2026-09-13

First public OSS release of Liro, a self-hosted collaborative whiteboard.

### Added

- Real-time collaborative boards over WebSocket, with a Go API and React/Vite SPA
- Drawing tools: shapes, sticky notes, text, frames, lanes, groups, lines, and splines
- Visio-like orthogonal connectors with side ports and in-place editing
- Multi-select transform controls for moving and resizing selections
- Emoji sticker objects on the canvas
- Board management: passwords, archive/restore, and import/export
- Asset uploads for board attachments
- MCP endpoint (`/mcp`) so agents can list, join, view, and edit boards
- Local development via `make dev` / `make run`, plus a multi-stage Docker image
- GitLab CI build and container publish pipeline
