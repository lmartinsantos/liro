# Liro — Go API + Vite frontend
#
#   make dev     API + Vite with hot reload
#   make run     serve the built SPA from the Go server
#   make build   compile web/dist, embed it, and bin/liro

BIN := bin/liro
WEB := web
EMBED_DIST := internal/static/dist

ADDR ?= :8080
DATA ?= data

export LIRO_ADDR ?= $(ADDR)
export LIRO_DATA ?= $(DATA)

VERSION := $(shell sed -n 's/^liro=//p' VERSIONS)
LDFLAGS := -s -w -X main.version=$(VERSION)

.DEFAULT_GOAL := help

IMAGE ?= liro

.PHONY: help deps build build-web build-server sync-embed embed-placeholder run server web dev test lint clean docker docker-run publish-github

help:
	@echo "Liro"
	@echo
	@echo "  make dev             API ($(ADDR)) + Vite (http://127.0.0.1:5173)"
	@echo "  make run             build the SPA and serve it from the Go server"
	@echo "  make build           build SPA, embed into $(BIN)"
	@echo "  make server          API only"
	@echo "  make web             Vite only"
	@echo "  make test            Go tests"
	@echo "  make lint            frontend lint"
	@echo "  make docker          build the container image ($(IMAGE))"
	@echo "  make docker-run      run the image on port 8080 (volume: liro-data)"
	@echo "  make publish-github  push lab-stripped tree to github remote"
	@echo "  make clean           remove build artifacts"
	@echo
	@echo "  ADDR=$(ADDR)  DATA=$(DATA)  (or LIRO_ADDR / LIRO_DATA / LIRO_STATIC)"

deps:
	go mod download
	npm --prefix $(WEB) install

$(WEB)/node_modules:
	npm --prefix $(WEB) install

build-web: $(WEB)/node_modules
	npm --prefix $(WEB) run build

sync-embed: build-web
	rm -rf $(EMBED_DIST)
	mkdir -p $(EMBED_DIST)
	cp -a $(WEB)/dist/. $(EMBED_DIST)/

embed-placeholder:
	rm -rf $(EMBED_DIST)
	mkdir -p $(EMBED_DIST)
	printf '%s\n' \
		'<!doctype html>' \
		'<html lang="en">' \
		'  <head>' \
		'    <meta charset="utf-8" />' \
		'    <title>liro</title>' \
		'  </head>' \
		'  <body>' \
		'    <p>Build the SPA (<code>make build-web</code>) and rebuild to embed the UI.</p>' \
		'  </body>' \
		'</html>' > $(EMBED_DIST)/index.html

build-server:
	@mkdir -p $(dir $(BIN))
	CGO_ENABLED=0 go build -trimpath -ldflags="$(LDFLAGS)" -o $(BIN) ./cmd/server

build: sync-embed build-server

server:
	go run ./cmd/server

web: $(WEB)/node_modules
	npm --prefix $(WEB) run dev

# Foreground Vite; background API. Ctrl+C stops both.
dev: $(WEB)/node_modules
	@trap 'kill 0' INT TERM EXIT; \
	go run ./cmd/server & \
	npm --prefix $(WEB) run dev

run: build-web
	go run ./cmd/server

test:
	go test ./...

lint: $(WEB)/node_modules
	npm --prefix $(WEB) run lint

docker:
	docker build -t $(IMAGE) .

docker-run: docker
	docker run --rm -p 8080:8080 -v liro-data:/data $(IMAGE)

# Strip GitLab-only paths and push to the github remote (worktree-safe).
# Requires: git remote add github git@github.com:<you>/liro.git
# FORCE=1 make publish-github  — non-fast-forward push
publish-github:
	./scripts/publish-github.sh

clean:
	rm -rf $(BIN) $(WEB)/dist
	@$(MAKE) embed-placeholder
