# Liro

Liro is a self-hosted collaborative whiteboard. 

**Current release:** see [`VERSIONS`](VERSIONS) · **changes:** [`CHANGELOG.md`](CHANGELOG.md) · **license:** [GPL-2.0](LICENSE)

## Features

- Real-time multi-user boards (WebSocket sync)
- Shapes, sticky notes, text, stickers, frames, lanes, groups, and freeform paths
- Visio-like Orthogonal connectors with side ports
- Board passwords, archive/restore, and import/export
- MCP tools at `/mcp` for agent-driven sketching and layout

## Requirements

- Go **1.25+** (see `go.mod` and `VERSIONS`)
- Node.js **22+** (frontend build)
- Optional: Docker

## Quick start

### Development (API + Vite HMR)

```bash
make deps
make dev
```

- API: `http://127.0.0.1:8080`
- UI: `http://127.0.0.1:5173`

### Production-style local run

Builds `web/dist` and serves it from the Go server:

```bash
make run
```

Or build binaries once:

```bash
make build   # web/dist + bin/liro
./bin/liro
```

### Docker

```bash
make docker-run
# equivalent:
# docker build -t liro .
# docker run --rm -p 8080:8080 -v liro-data:/data liro
```

Open `http://127.0.0.1:8080`.

## Configuration

| Variable     | Default     | Meaning                          |
|--------------|-------------|----------------------------------|
| `LIRO_ADDR`  | `:8080`     | Listen address                   |
| `LIRO_DATA`  | `data`      | On-disk board store              |
| `LIRO_STATIC`| `web/dist`* | SPA directory (`*` if present)   |

Makefile shortcuts: `ADDR`, `DATA` (exported as the `LIRO_*` vars above).

## MCP

With the server running, point an MCP client at `http://127.0.0.1:8080/mcp`. Agent workflow and tool notes live in [`internal/mcp/skill.md`](internal/mcp/skill.md).

## Development commands

| Command          | Purpose                         |
|------------------|---------------------------------|
| `make test`      | Go tests                        |
| `make lint`      | Frontend lint (oxlint)          |
| `make clean`     | Remove `bin/liro` and `web/dist`|

## License

Liro is free software: you can redistribute it and/or modify it under the terms of the **GNU General Public License as published by the Free Software Foundation; either version 2 of the License, or (at your option) any later version**.

See [`LICENSE`](LICENSE) for the full GPLv2 text.
