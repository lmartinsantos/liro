package store

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

var tinyPNG = []byte{
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
	0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
	0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
	0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
	0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
	0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
}

func TestSaveAndReadAsset(t *testing.T) {
	dir := t.TempDir()
	st, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	rec, err := st.Create("Assets")
	if err != nil {
		t.Fatal(err)
	}
	name, err := rec.SaveAsset("png", tinyPNG)
	if err != nil {
		t.Fatal(err)
	}
	if !ValidAssetName(name) {
		t.Fatalf("name %s", name)
	}
	path, err := rec.AssetPath(name)
	if err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != len(tinyPNG) {
		t.Fatalf("size %d", len(got))
	}
	if _, err := rec.AssetPath("../meta.json"); err == nil {
		t.Fatal("expected traversal reject")
	}
	if _, err := rec.AssetPath(".."); err == nil {
		t.Fatal("expected invalid name")
	}
}

func TestCreateAndSnapshotPolicy(t *testing.T) {
	dir := t.TempDir()
	st, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	rec, err := st.Create("Sprint")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "boards", rec.Meta.ID, "board.json")); err != nil {
		t.Fatal(err)
	}

	rec.WithLock(func() {
		rec.Document.Rev = 1
		rec.MarkDirty(FileBoard)
		rec.files[FileBoard].lastWrite = time.Now().Add(-2 * time.Minute)
		rec.files[FileBoard].lastSnapshot = time.Now().Add(-2 * time.Minute)
	})
	rec.maybeSnapshot(time.Now(), false)

	snaps, err := st.ListSnapshots(rec.Meta.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(snaps) == 0 {
		t.Fatal("expected idle snapshot")
	}

	rec.WithLock(func() {
		if rec.files[FileBoard].dirty {
			t.Fatal("board should be clean after snapshot")
		}
	})

	rec.WithLock(func() {
		rec.MarkDirty(FileBoard)
	})
	rec.maybeSnapshot(time.Now(), false)
	snaps2, _ := st.ListSnapshots(rec.Meta.ID)
	if len(snaps2) != len(snaps) {
		t.Fatal("should not snapshot immediately after a new edit")
	}
}
