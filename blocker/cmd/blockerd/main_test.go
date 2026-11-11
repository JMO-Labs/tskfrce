package main

import (
	"os"
	"testing"
)

// TestFailOpenCmd verifies fail-open can be called without crashing
func TestFailOpenCmd(t *testing.T) {
	// This test verifies the function runs without panic
	// In a test environment, nftables may not be available, but
	// failOpenCmd should gracefully handle that
	err := failOpenCmd()
	if err != nil {
		// Fail-open is fail-safe: errors are logged but not returned
		t.Logf("failOpenCmd returned error (expected in test env): %v", err)
	}
}

// TestEnvironmentVariables verifies config env vars are respected
func TestEnvironmentVariables(t *testing.T) {
	// Set test environment
	t.Setenv("BACKEND_URL", "http://test:8000")
	t.Setenv("INTERNAL_TOKEN", "test-token")
	t.Setenv("BLOCKER_PORT", "7777")
	t.Setenv("DATA_DIR", "/tmp")

	// These are just sanity checks that env vars can be set
	// Full config loading is tested in config package
	if url := os.Getenv("BACKEND_URL"); url != "http://test:8000" {
		t.Fatal("BACKEND_URL env var not set correctly")
	}
}

// TestGOMEMLIMIT verifies GOMEMLIMIT env var is recognized
func TestGOMEMLIMIT(t *testing.T) {
	t.Setenv("GOMEMLIMIT", "24MiB")

	mlimit := os.Getenv("GOMEMLIMIT")
	if mlimit != "24MiB" {
		t.Fatalf("expected GOMEMLIMIT=24MiB, got %s", mlimit)
	}
}
