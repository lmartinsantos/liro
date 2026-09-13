# Liro — SPA + API in one image
#
#   docker build -t liro .
#   docker run --rm -p 8080:8080 -v liro-data:/data liro

# --- frontend --------------------------------------------------------------
FROM node:22-alpine AS web
WORKDIR /src
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# --- backend ---------------------------------------------------------------
FROM golang:1.25-alpine AS server
WORKDIR /src
RUN apk add --no-cache ca-certificates git
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /liro ./cmd/server

# --- runtime ---------------------------------------------------------------
FROM alpine:3.21
RUN adduser -D -H -u 65532 liro \
	&& mkdir -p /data \
	&& chown liro:liro /data

COPY --from=server /liro /liro
COPY --from=web /src/dist /web/dist

ENV LIRO_ADDR=:8080 \
	LIRO_DATA=/data \
	LIRO_STATIC=/web/dist

EXPOSE 8080
VOLUME /data
USER liro
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
	CMD wget -qO- http://127.0.0.1:8080/api/boards >/dev/null || exit 1

ENTRYPOINT ["/liro"]
