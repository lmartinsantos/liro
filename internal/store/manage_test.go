package store_test

import (
	"bytes"
	"testing"

	"liro/internal/auth"
	"liro/internal/store"
)

func TestArchiveExportImportDelete(t *testing.T) {
	st, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(st.Close)

	rec, err := st.Create("Backup me")
	if err != nil {
		t.Fatal(err)
	}
	id := rec.Meta.ID

	hash, err := auth.HashPassword("pw")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.SetPassword(id, hash); err != nil {
		t.Fatal(err)
	}

	if _, err := st.Archive(id); err != nil {
		t.Fatal(err)
	}
	active, err := st.List(false)
	if err != nil || len(active) != 0 {
		t.Fatalf("active: %v %d", err, len(active))
	}
	archived, err := st.List(true)
	if err != nil || len(archived) != 1 {
		t.Fatalf("archived: %v %d", err, len(archived))
	}

	if _, err := st.Restore(id); err != nil {
		t.Fatal(err)
	}

	data, err := st.ExportBytes(id)
	if err != nil {
		t.Fatal(err)
	}
	imported, err := st.Import(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	if imported.Meta.ID == id {
		t.Fatal("expected new id")
	}
	if imported.Meta.Name != "Backup me" {
		t.Fatalf("name: %s", imported.Meta.Name)
	}
	if !imported.Meta.HasPassword() {
		t.Fatal("password should be preserved")
	}

	if err := st.Delete(id); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Get(id); err == nil {
		t.Fatal("expected missing after delete")
	}
}
