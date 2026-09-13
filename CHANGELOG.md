# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Version numbers are defined in [`VERSIONS`](VERSIONS).

## [Unreleased]

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
