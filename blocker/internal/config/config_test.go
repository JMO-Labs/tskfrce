package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestLoadWithEnvToken(t *testing.T) {
	// Save original env
	oldToken := os.Getenv("INTERNAL_TOKEN")
	defer os.Setenv("INTERNAL_TOKEN", oldToken)

	os.Setenv("INTERNAL_TOKEN", "envtoken123")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() failed: %v", err)
	}

	if cfg.InternalToken != "envtoken123" {
		t.Errorf("got InternalToken %q, want %q", cfg.InternalToken, "envtoken123")
	}
}

func TestLoadWithSecretsFileToken(t *testing.T) {
	// Save original env
	oldToken := os.Getenv("INTERNAL_TOKEN")
	oldDataDir := os.Getenv("DATA_DIR")
	defer os.Setenv("INTERNAL_TOKEN", oldToken)
	defer os.Setenv("DATA_DIR", oldDataDir)

	// Clear env token
	os.Setenv("INTERNAL_TOKEN", "")

	tmpDir := t.TempDir()
	os.Setenv("DATA_DIR", tmpDir)

	// Create secrets.json
	secrets := map[string]string{"INTERNAL_TOKEN": "filetok123"}
	data, _ := json.Marshal(secrets)
	if err := os.WriteFile(filepath.Join(tmpDir, "secrets.json"), data, 0o644); err != nil {
		t.Fatalf("WriteFile failed: %v", err)
	}

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() failed: %v", err)
	}

	if cfg.InternalToken != "filetok123" {
		t.Errorf("got InternalToken %q, want %q", cfg.InternalToken, "filetok123")
	}
}

func TestLoadEnvTokenOverridesSecretsFile(t *testing.T) {
	// Save original env
	oldToken := os.Getenv("INTERNAL_TOKEN")
	oldDataDir := os.Getenv("DATA_DIR")
	defer os.Setenv("INTERNAL_TOKEN", oldToken)
	defer os.Setenv("DATA_DIR", oldDataDir)

	tmpDir := t.TempDir()
	os.Setenv("DATA_DIR", tmpDir)

	// Create secrets.json
	secrets := map[string]string{"INTERNAL_TOKEN": "filetok"}
	data, _ := json.Marshal(secrets)
	os.WriteFile(filepath.Join(tmpDir, "secrets.json"), data, 0o644)

	os.Setenv("INTERNAL_TOKEN", "envtok")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() failed: %v", err)
	}

	if cfg.InternalToken != "envtok" {
		t.Errorf("got InternalToken %q, want %q", cfg.InternalToken, "envtok")
	}
}

func TestLoadEmptyTokenFails(t *testing.T) {
	// Save original env
	oldToken := os.Getenv("INTERNAL_TOKEN")
	oldDataDir := os.Getenv("DATA_DIR")
	defer os.Setenv("INTERNAL_TOKEN", oldToken)
	defer os.Setenv("DATA_DIR", oldDataDir)

	os.Setenv("INTERNAL_TOKEN", "")

	tmpDir := t.TempDir()
	os.Setenv("DATA_DIR", tmpDir)

	// No secrets.json, no env token
	_, err := Load()
	if err == nil {
		t.Errorf("Load() should fail with no token, but got nil error")
	}
}

func TestLoadDefaultValues(t *testing.T) {
	// Save original env
	oldToken := os.Getenv("INTERNAL_TOKEN")
	oldDataDir := os.Getenv("DATA_DIR")
	oldBackendURL := os.Getenv("BACKEND_URL")
	oldBlockerPort := os.Getenv("BLOCKER_PORT")
	oldBlockerBind := os.Getenv("BLOCKER_BIND")
	oldScanInterval := os.Getenv("SCAN_INTERVAL")
	oldReconcileInterval := os.Getenv("RECONCILE_INTERVAL")
	oldResistInterval := os.Getenv("RESIST_INTERVAL")
	oldPortalURL := os.Getenv("PORTAL_REDIRECT_URL")

	defer os.Setenv("INTERNAL_TOKEN", oldToken)
	defer os.Setenv("DATA_DIR", oldDataDir)
	defer os.Setenv("BACKEND_URL", oldBackendURL)
	defer os.Setenv("BLOCKER_PORT", oldBlockerPort)
	defer os.Setenv("BLOCKER_BIND", oldBlockerBind)
	defer os.Setenv("SCAN_INTERVAL", oldScanInterval)
	defer os.Setenv("RECONCILE_INTERVAL", oldReconcileInterval)
	defer os.Setenv("RESIST_INTERVAL", oldResistInterval)
	defer os.Setenv("PORTAL_REDIRECT_URL", oldPortalURL)

	tmpDir := t.TempDir()

	os.Setenv("INTERNAL_TOKEN", "token")
	os.Setenv("DATA_DIR", tmpDir)
	os.Setenv("BACKEND_URL", "")
	os.Setenv("BLOCKER_PORT", "")
	os.Setenv("BLOCKER_BIND", "")
	os.Setenv("SCAN_INTERVAL", "")
	os.Setenv("RECONCILE_INTERVAL", "")
	os.Setenv("RESIST_INTERVAL", "")
	os.Setenv("PORTAL_REDIRECT_URL", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() failed: %v", err)
	}

	if cfg.BackendURL != "http://backend:8000" {
		t.Errorf("got BackendURL %q, want %q", cfg.BackendURL, "http://backend:8000")
	}
	if cfg.BlockerPort != 7777 {
		t.Errorf("got BlockerPort %d, want %d", cfg.BlockerPort, 7777)
	}
	if len(cfg.BlockerBind) != 1 || cfg.BlockerBind[0] != "127.0.0.1" {
		t.Errorf("got BlockerBind %v, want [127.0.0.1]", cfg.BlockerBind)
	}
	if cfg.ScanInterval != 20.0 {
		t.Errorf("got ScanInterval %f, want %f", cfg.ScanInterval, 20.0)
	}
	if cfg.ReconcileInterval != 30.0 {
		t.Errorf("got ReconcileInterval %f, want %f", cfg.ReconcileInterval, 30.0)
	}
	if cfg.ResistInterval != 15.0 {
		t.Errorf("got ResistInterval %f, want %f", cfg.ResistInterval, 15.0)
	}
	if cfg.PortalRedirectURL != "http://task4ce.local/kid" {
		t.Errorf("got PortalRedirectURL %q, want %q", cfg.PortalRedirectURL, "http://task4ce.local/kid")
	}
}

func TestLoadCommaSeparatedBlockerBind(t *testing.T) {
	// Save original env
	oldToken := os.Getenv("INTERNAL_TOKEN")
	oldBlockerBind := os.Getenv("BLOCKER_BIND")
	defer os.Setenv("INTERNAL_TOKEN", oldToken)
	defer os.Setenv("BLOCKER_BIND", oldBlockerBind)

	os.Setenv("INTERNAL_TOKEN", "token")
	os.Setenv("BLOCKER_BIND", "127.0.0.1,192.168.1.1")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() failed: %v", err)
	}

	if len(cfg.BlockerBind) != 2 {
		t.Errorf("got BlockerBind length %d, want 2", len(cfg.BlockerBind))
	}
	if cfg.BlockerBind[0] != "127.0.0.1" {
		t.Errorf("got BlockerBind[0] %q, want %q", cfg.BlockerBind[0], "127.0.0.1")
	}
	if cfg.BlockerBind[1] != "192.168.1.1" {
		t.Errorf("got BlockerBind[1] %q, want %q", cfg.BlockerBind[1], "192.168.1.1")
	}
}

func TestLoadIntervalsParsedAsFloats(t *testing.T) {
	// Save original env
	oldToken := os.Getenv("INTERNAL_TOKEN")
	oldScanInterval := os.Getenv("SCAN_INTERVAL")
	defer os.Setenv("INTERNAL_TOKEN", oldToken)
	defer os.Setenv("SCAN_INTERVAL", oldScanInterval)

	os.Setenv("INTERNAL_TOKEN", "token")
	os.Setenv("SCAN_INTERVAL", "25.5")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() failed: %v", err)
	}

	if cfg.ScanInterval != 25.5 {
		t.Errorf("got ScanInterval %f, want %f", cfg.ScanInterval, 25.5)
	}
}

func TestLoadInvalidPortFails(t *testing.T) {
	// Save original env
	oldToken := os.Getenv("INTERNAL_TOKEN")
	oldBlockerPort := os.Getenv("BLOCKER_PORT")
	defer os.Setenv("INTERNAL_TOKEN", oldToken)
	defer os.Setenv("BLOCKER_PORT", oldBlockerPort)

	os.Setenv("INTERNAL_TOKEN", "token")
	os.Setenv("BLOCKER_PORT", "invalid")

	_, err := Load()
	if err == nil {
		t.Errorf("Load() should fail with invalid port, but got nil error")
	}
}

func TestLoadInvalidIntervalFails(t *testing.T) {
	// Save original env
	oldToken := os.Getenv("INTERNAL_TOKEN")
	oldScanInterval := os.Getenv("SCAN_INTERVAL")
	defer os.Setenv("INTERNAL_TOKEN", oldToken)
	defer os.Setenv("SCAN_INTERVAL", oldScanInterval)

	os.Setenv("INTERNAL_TOKEN", "token")
	os.Setenv("SCAN_INTERVAL", "not-a-number")

	_, err := Load()
	if err == nil {
		t.Errorf("Load() should fail with invalid interval, but got nil error")
	}
}
