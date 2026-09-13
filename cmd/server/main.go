package main

import (
	"context"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"liro/internal/api"
	"liro/internal/hub"
	"liro/internal/static"
	"liro/internal/store"
)

// Set at link time: -ldflags "-X main.version=X.Y.Z"
var version = "dev"

func main() {
	addr := env("LIRO_ADDR", ":8080")
	dataDir := env("LIRO_DATA", "data")

	abs, err := filepath.Abs(dataDir)
	if err != nil {
		log.Fatal(err)
	}
	st, err := store.New(abs)
	if err != nil {
		log.Fatal(err)
	}

	hubs := hub.NewRegistry(st)
	handler := api.New(st, hubs, resolveStatic())

	srv := &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("liro %s listening on %s (data=%s mcp=/mcp)", version, addr, abs)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()

	ch := make(chan os.Signal, 1)
	signal.Notify(ch, syscall.SIGINT, syscall.SIGTERM)
	<-ch

	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
	hubs.Close()
	st.Close()
	log.Println("liro stopped")
}

func resolveStatic() fs.FS {
	if v := os.Getenv("LIRO_STATIC"); v != "" {
		return os.DirFS(v)
	}
	if st, err := os.Stat("web/dist"); err == nil && st.IsDir() {
		return os.DirFS("web/dist")
	}
	return static.FS()
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
