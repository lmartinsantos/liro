// Package static embeds the built SPA (web/dist synced into dist/).
//
// A minimal placeholder index.html is committed so bare go test / go build
// work without a frontend build. make build and release CI replace dist/
// with the real Vite output before compiling.
package static

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var dist embed.FS

// FS returns the embedded SPA root (contents of dist/).
func FS() fs.FS {
	sub, err := fs.Sub(dist, "dist")
	if err != nil {
		panic("internal/static: " + err.Error())
	}
	return sub
}
