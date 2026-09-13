package auth_test

import (
	"testing"
	"time"

	"liro/internal/auth"
)

func TestHashAndToken(t *testing.T) {
	hash, err := auth.HashPassword("secret")
	if err != nil {
		t.Fatal(err)
	}
	if err := auth.CheckPassword(hash, "secret"); err != nil {
		t.Fatal(err)
	}
	if err := auth.CheckPassword(hash, "nope"); err != auth.ErrBadPassword {
		t.Fatalf("want ErrBadPassword, got %v", err)
	}

	tok := auth.NewTokens("test-secret")
	token, exp, err := tok.Issue("brd_abc")
	if err != nil {
		t.Fatal(err)
	}
	if time.Until(exp) < 23*time.Hour {
		t.Fatalf("expiry too soon: %v", exp)
	}
	if err := tok.Verify("brd_abc", token); err != nil {
		t.Fatal(err)
	}
	if err := tok.Verify("brd_other", token); err != auth.ErrBadToken {
		t.Fatalf("want ErrBadToken, got %v", err)
	}
}
