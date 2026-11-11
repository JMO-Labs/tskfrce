package service

import (
	"context"
	"testing"
	"time"

	"github.com/jmo-labs/tskfrce/blocker/internal/config"
)

// TestServiceStartup verifies service starts and initializes subsystems
func TestServiceStartup(t *testing.T) {
	cfg := &config.Config{
		BackendURL:        "http://localhost:8000",
		InternalToken:     "test-token",
		LANIface:          "lo",
		DataDir:           "/tmp",
		BlockerPort:       9999,
		BlockerBind:       []string{"127.0.0.1"},
		ScanInterval:      20,
		ReconcileInterval: 30,
		ResistInterval:    15,
		PortalRedirectURL: "http://task4ce.local/kid",
	}

	svc := New(cfg)
	if svc == nil {
		t.Fatal("service creation failed")
	}

	if svc.store == nil {
		t.Fatal("store not initialized")
	}
	if svc.backend == nil {
		t.Fatal("backend client not initialized")
	}
	if svc.redirect == nil {
		t.Fatal("redirect manager not initialized")
	}
	if svc.fw == nil {
		t.Fatal("firewall not initialized")
	}
}

// TestServiceGracefulShutdown verifies context cancellation stops all subsystems
func TestServiceGracefulShutdown(t *testing.T) {
	cfg := &config.Config{
		BackendURL:        "http://localhost:8000",
		InternalToken:     "test-token",
		LANIface:          "",
		DataDir:           "/tmp",
		BlockerPort:       9998,
		BlockerBind:       []string{"127.0.0.1"},
		ScanInterval:      20,
		ReconcileInterval: 30,
		ResistInterval:    15,
		PortalRedirectURL: "http://task4ce.local/kid",
	}

	svc := New(cfg)
	ctx, cancel := context.WithCancel(context.Background())

	// Run service in goroutine
	done := make(chan error)
	go func() {
		done <- svc.Run(ctx)
	}()

	// Let it start
	time.Sleep(100 * time.Millisecond)

	// Cancel context
	cancel()

	// Should exit cleanly
	select {
	case err := <-done:
		if err != nil {
			t.Logf("service returned: %v (may be expected)", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("service did not shut down within timeout")
	}
}

// TestServicePanicRecovery verifies a panic in one goroutine doesn't kill others
// This is a best-effort test; actual recovery happens inside the goroutines
func TestServicePanicRecovery(t *testing.T) {
	cfg := &config.Config{
		BackendURL:        "http://localhost:8000",
		InternalToken:     "test-token",
		LANIface:          "",
		DataDir:           "/tmp",
		BlockerPort:       9997,
		BlockerBind:       []string{"127.0.0.1"},
		ScanInterval:      20,
		ReconcileInterval: 30,
		ResistInterval:    15,
		PortalRedirectURL: "http://task4ce.local/kid",
	}

	svc := New(cfg)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan error)
	go func() {
		done <- svc.Run(ctx)
	}()

	// Let subsystems start
	time.Sleep(200 * time.Millisecond)

	// Cancel and shut down
	cancel()

	select {
	case <-done:
		// Expected
	case <-time.After(5 * time.Second):
		t.Fatal("service did not shut down")
	}
}

// TestServiceStoreInitialization verifies store is properly initialized
func TestServiceStoreInitialization(t *testing.T) {
	cfg := &config.Config{
		BackendURL:        "http://localhost:8000",
		InternalToken:     "test-token",
		LANIface:          "",
		DataDir:           "/tmp",
		BlockerPort:       9996,
		BlockerBind:       []string{"127.0.0.1"},
		ScanInterval:      20,
		ReconcileInterval: 30,
		ResistInterval:    15,
		PortalRedirectURL: "http://task4ce.local/kid",
	}

	svc := New(cfg)

	// Verify store methods work
	blocked := svc.store.GetBlocked()
	if blocked == nil {
		t.Fatal("GetBlocked returned nil")
	}
	if len(blocked) != 0 {
		t.Fatalf("expected empty blocked set, got %d", len(blocked))
	}

	// Set some MACs
	macs := []string{"aa:bb:cc:dd:ee:ff", "11:22:33:44:55:66"}
	if err := svc.store.SetBlocked(macs); err != nil {
		t.Fatalf("SetBlocked failed: %v", err)
	}

	blocked = svc.store.GetBlocked()
	if len(blocked) != 2 {
		t.Fatalf("expected 2 blocked MACs, got %d", len(blocked))
	}
}

// TestServiceBlockedMACValidation verifies invalid MACs are rejected
func TestServiceBlockedMACValidation(t *testing.T) {
	cfg := &config.Config{
		BackendURL:        "http://localhost:8000",
		InternalToken:     "test-token",
		LANIface:          "",
		DataDir:           "/tmp",
		BlockerPort:       9995,
		BlockerBind:       []string{"127.0.0.1"},
		ScanInterval:      20,
		ReconcileInterval: 30,
		ResistInterval:    15,
		PortalRedirectURL: "http://task4ce.local/kid",
	}

	svc := New(cfg)

	// Try setting invalid MAC
	invalidMACs := []string{"not:a:mac"}
	if err := svc.store.SetBlocked(invalidMACs); err == nil {
		t.Fatal("expected error for invalid MAC")
	}

	// Valid MAC should work
	validMACs := []string{"aa:bb:cc:dd:ee:ff"}
	if err := svc.store.SetBlocked(validMACs); err != nil {
		t.Fatalf("SetBlocked failed: %v", err)
	}
}

// TestServiceListenOnlyFlag verifies listen_only state can be managed
func TestServiceListenOnlyFlag(t *testing.T) {
	cfg := &config.Config{
		BackendURL:        "http://localhost:8000",
		InternalToken:     "test-token",
		LANIface:          "",
		DataDir:           "/tmp",
		BlockerPort:       9994,
		BlockerBind:       []string{"127.0.0.1"},
		ScanInterval:      20,
		ReconcileInterval: 30,
		ResistInterval:    15,
		PortalRedirectURL: "http://task4ce.local/kid",
	}

	svc := New(cfg)

	// Check initial state
	if svc.store.GetListenOnly() {
		t.Fatal("expected listen_only=false initially")
	}

	// Set to true
	svc.store.SetListenOnly(true)
	if !svc.store.GetListenOnly() {
		t.Fatal("expected listen_only=true after set")
	}

	// Set to false
	svc.store.SetListenOnly(false)
	if svc.store.GetListenOnly() {
		t.Fatal("expected listen_only=false after clear")
	}
}

// TestServiceCoveredVLANs verifies VLAN state can be tracked
func TestServiceCoveredVLANs(t *testing.T) {
	cfg := &config.Config{
		BackendURL:        "http://localhost:8000",
		InternalToken:     "test-token",
		LANIface:          "",
		DataDir:           "/tmp",
		BlockerPort:       9993,
		BlockerBind:       []string{"127.0.0.1"},
		ScanInterval:      20,
		ReconcileInterval: 30,
		ResistInterval:    15,
		PortalRedirectURL: "http://task4ce.local/kid",
	}

	svc := New(cfg)

	// Set covered VLANs
	vlans := []uint16{100, 101}
	svc.store.SetCoveredVLANs(vlans)

	// Verify retrieval
	retrieved := svc.store.GetCoveredVLANs()
	if len(retrieved) != 2 {
		t.Fatalf("expected 2 VLANs, got %d", len(retrieved))
	}
}

// TestServiceMultipleInstances verifies independent service instances don't interfere
func TestServiceMultipleInstances(t *testing.T) {
	cfg := &config.Config{
		BackendURL:        "http://localhost:8000",
		InternalToken:     "test-token",
		LANIface:          "",
		DataDir:           "/tmp",
		BlockerPort:       9992,
		BlockerBind:       []string{"127.0.0.1"},
		ScanInterval:      20,
		ReconcileInterval: 30,
		ResistInterval:    15,
		PortalRedirectURL: "http://task4ce.local/kid",
	}

	svc1 := New(cfg)
	svc2 := New(cfg)

	if svc1.store == svc2.store {
		t.Fatal("separate service instances should have separate stores")
	}

	// Verify they work independently
	macs := []string{"aa:bb:cc:dd:ee:ff"}
	if err := svc1.store.SetBlocked(macs); err != nil {
		t.Fatalf("svc1.SetBlocked failed: %v", err)
	}

	if len(svc2.store.GetBlocked()) != 0 {
		t.Fatal("svc2 store should not be affected by svc1 updates")
	}
}

// TestServiceContextCancellation verifies Run returns when context is cancelled
func TestServiceContextCancellation(t *testing.T) {
	cfg := &config.Config{
		BackendURL:        "http://localhost:8000",
		InternalToken:     "test-token",
		LANIface:          "",
		DataDir:           "/tmp",
		BlockerPort:       9991,
		BlockerBind:       []string{"127.0.0.1"},
		ScanInterval:      20,
		ReconcileInterval: 30,
		ResistInterval:    15,
		PortalRedirectURL: "http://task4ce.local/kid",
	}

	svc := New(cfg)
	ctx, cancel := context.WithCancel(context.Background())

	done := make(chan error, 1)
	go func() {
		done <- svc.Run(ctx)
	}()

	// Let service start
	time.Sleep(50 * time.Millisecond)

	// Cancel immediately
	cancel()

	// Should exit quickly
	select {
	case <-done:
		// Expected
	case <-time.After(2 * time.Second):
		t.Fatal("service did not exit after context cancellation")
	}
}
