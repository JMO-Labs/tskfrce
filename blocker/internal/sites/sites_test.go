package sites

import (
	"log/slog"
	"net"
	"testing"
)

func TestNewManager(t *testing.T) {
	logger := slog.Default()
	m := New("eth0", logger)
	if m == nil {
		t.Fatal("manager is nil")
	}
	if m.lanIface != "eth0" {
		t.Fatalf("lanIface not set: %s", m.lanIface)
	}
}

func TestNewSite(t *testing.T) {
	site := &Site{
		VID:       100,
		IfaceName: "eth0.100",
	}

	if site.VID != 100 {
		t.Fatalf("VID not set: %d", site.VID)
	}
	if site.IfaceName != "eth0.100" {
		t.Fatalf("IfaceName not set: %s", site.IfaceName)
	}
}

func TestSyncEmptyVLANs(t *testing.T) {
	logger := slog.Default()
	m := New("eth0", logger)

	// Sync with empty list should not crash
	err := m.Sync([]uint16{})
	if err != nil {
		t.Fatalf("sync failed: %v", err)
	}
}

func TestSyncWithoutLANIface(t *testing.T) {
	logger := slog.Default()
	m := New("", logger)

	// F50: sync only when LAN_IFACE is set
	// Should return without doing anything
	err := m.Sync([]uint16{100, 200})
	if err != nil {
		t.Fatalf("sync should return nil: %v", err)
	}

	// No sites should be created
	sites := m.GetSites()
	if len(sites) != 0 {
		t.Fatalf("expected no sites, got %d", len(sites))
	}
}

func TestGetSites(t *testing.T) {
	logger := slog.Default()
	m := New("", logger)

	m.mu.Lock()
	m.sites[100] = &Site{
		VID:       100,
		IfaceName: "eth0.100",
	}
	m.sites[200] = &Site{
		VID:       200,
		IfaceName: "eth0.200",
	}
	m.mu.Unlock()

	sites := m.GetSites()
	if len(sites) != 2 {
		t.Fatalf("expected 2 sites, got %d", len(sites))
	}

	if _, exists := sites[100]; !exists {
		t.Fatal("VLAN 100 not in sites")
	}
	if _, exists := sites[200]; !exists {
		t.Fatal("VLAN 200 not in sites")
	}
}

func TestGetInfrastructureExclusions(t *testing.T) {
	logger := slog.Default()
	m := New("", logger)

	m.mu.Lock()
	m.sites[100] = &Site{
		VID:     100,
		Gateway: net.ParseIP("192.168.1.1"),
		IPAddr:  net.ParseIP("192.168.1.253"),
	}
	m.sites[200] = &Site{
		VID:     200,
		Gateway: net.ParseIP("192.168.2.1"),
		IPAddr:  net.ParseIP("192.168.2.253"),
	}
	m.mu.Unlock()

	gateways, boxIPs := m.GetInfrastructureExclusions()

	if len(gateways) != 2 {
		t.Fatalf("expected 2 gateways, got %d", len(gateways))
	}
	if len(boxIPs) != 2 {
		t.Fatalf("expected 2 box IPs, got %d", len(boxIPs))
	}
}

func TestGetInfrastructureExclusionsEmpty(t *testing.T) {
	logger := slog.Default()
	m := New("", logger)

	gateways, boxIPs := m.GetInfrastructureExclusions()

	if len(gateways) != 0 {
		t.Fatalf("expected 0 gateways, got %d", len(gateways))
	}
	if len(boxIPs) != 0 {
		t.Fatalf("expected 0 box IPs, got %d", len(boxIPs))
	}
}

func TestSiteActive(t *testing.T) {
	site := &Site{
		VID:       100,
		IfaceName: "eth0.100",
		IsActive:  false,
	}

	if site.IsActive {
		t.Fatal("site should not be active initially")
	}

	site.IsActive = true
	if !site.IsActive {
		t.Fatal("site should be active after setting")
	}
}

func TestSiteCreatedByUs(t *testing.T) {
	logger := slog.Default()
	m := New("eth0", logger)

	m.mu.Lock()
	m.createdIfaces["eth0.100"] = true
	m.mu.Unlock()

	if !m.createdIfaces["eth0.100"] {
		t.Fatal("interface not marked as created by us")
	}
}

func TestStop(t *testing.T) {
	logger := slog.Default()
	m := New("", logger)

	m.mu.Lock()
	m.sites[100] = &Site{
		VID:       100,
		IfaceName: "eth0.100",
	}
	m.mu.Unlock()

	m.Stop()

	sites := m.GetSites()
	if len(sites) != 0 {
		t.Fatalf("expected 0 sites after stop, got %d", len(sites))
	}
}

func TestSiteSubnet(t *testing.T) {
	_, subnet, _ := net.ParseCIDR("192.168.1.0/24")

	site := &Site{
		VID:    100,
		Subnet: subnet,
	}

	if site.Subnet == nil {
		t.Fatal("subnet not set")
	}
	if site.Subnet.String() != "192.168.1.0/24" {
		t.Fatalf("subnet mismatch: %s", site.Subnet.String())
	}
}

func TestMultipleSites(t *testing.T) {
	logger := slog.Default()
	m := New("", logger)

	m.mu.Lock()
	for vid := uint16(1); vid <= 5; vid++ {
		m.sites[vid] = &Site{
			VID:       vid,
			IfaceName: "",
			IsActive:  false,
		}
	}
	m.mu.Unlock()

	sites := m.GetSites()
	if len(sites) != 5 {
		t.Fatalf("expected 5 sites, got %d", len(sites))
	}

	// Verify VID values
	for vid := uint16(1); vid <= 5; vid++ {
		if _, exists := sites[vid]; !exists {
			t.Fatalf("VLAN %d not found", vid)
		}
	}
}

func TestSiteConcurrentAccess(t *testing.T) {
	logger := slog.Default()
	m := New("", logger)

	// Concurrent reads and writes
	done := make(chan struct{})
	for i := 0; i < 10; i++ {
		go func(idx int) {
			vid := uint16(100 + idx)
			m.mu.Lock()
			m.sites[vid] = &Site{
				VID:       vid,
				IfaceName: "",
			}
			m.mu.Unlock()

			// Trigger cleanup
			m.GetSites()
			done <- struct{}{}
		}(i)
	}

	for i := 0; i < 10; i++ {
		<-done
	}

	sites := m.GetSites()
	if len(sites) < 10 {
		t.Fatalf("expected at least 10 sites, got %d", len(sites))
	}
}

// Benchmark site operations
func BenchmarkGetSites(b *testing.B) {
	logger := slog.Default()
	m := New("", logger)

	// Create some sites
	m.mu.Lock()
	for vid := uint16(1); vid <= 100; vid++ {
		m.sites[vid] = &Site{
			VID:       vid,
			IfaceName: "",
		}
	}
	m.mu.Unlock()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		m.GetSites()
	}
}
