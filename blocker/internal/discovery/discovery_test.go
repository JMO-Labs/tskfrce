package discovery

import (
	"testing"

	"github.com/jmo-labs/tskfrce/blocker/internal/backend"
)

func TestNewScanner(t *testing.T) {
	s := NewScanner("eth0")
	if s.iface != "eth0" {
		t.Errorf("iface = %s, want eth0", s.iface)
	}
}

func TestScanOnceEmpty(t *testing.T) {
	s := NewScanner("eth0")
	called := false
	s.ScanOnce(func(seen *backend.Seen) {
		called = true
	})
	// For now, should not call onSeen since we don't have real network code
	if called {
		t.Error("onSeen should not be called with empty network")
	}
}

func TestVendorLookup(t *testing.T) {
	// Test vendor lookup - for now should return nil
	vendor := vendorFor("aa:bb:cc:dd:ee:ff")
	if vendor != nil {
		t.Errorf("vendor = %v, want nil (not implemented)", vendor)
	}
}

func TestReverseDNS(t *testing.T) {
	// Test reverse DNS - for now should return nil
	hostname := reverseDNS("10.0.0.1")
	if hostname != nil {
		t.Errorf("hostname = %v, want nil (not implemented)", hostname)
	}
}
