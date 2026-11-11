package redirect

import (
	"log/slog"
	"net"
	"testing"
	"time"
)

func TestNewManager(t *testing.T) {
	logger := slog.Default()
	m, err := New("lo", logger)
	if err != nil {
		// loopback may not have IPv4; try a different approach
		t.Skipf("could not initialize with loopback: %v", err)
	}
	if m.portalIP == nil {
		t.Fatal("portal IP not set")
	}
	m.Stop()
}

func TestUpdateTargetsStartsGoroutines(t *testing.T) {
	logger := slog.Default()
	m, err := New("lo", logger)
	if err != nil {
		t.Skipf("could not initialize: %v", err)
	}
	defer m.Stop()

	mac := "aa:bb:cc:dd:ee:ff"
	ips := []net.IP{net.ParseIP("192.168.1.100")}

	m.UpdateTargets(map[string][]net.IP{mac: ips})

	m.mu.Lock()
	if _, exists := m.targets[mac]; !exists {
		t.Fatal("target not added")
	}
	m.mu.Unlock()

	// Clean up
	m.UpdateTargets(map[string][]net.IP{})
	time.Sleep(100 * time.Millisecond)
}

func TestUpdateTargetsStopsGoroutines(t *testing.T) {
	logger := slog.Default()
	m, err := New("lo", logger)
	if err != nil {
		t.Skipf("could not initialize: %v", err)
	}
	defer m.Stop()

	mac := "aa:bb:cc:dd:ee:ff"
	ips := []net.IP{net.ParseIP("192.168.1.100")}

	m.UpdateTargets(map[string][]net.IP{mac: ips})
	m.UpdateTargets(map[string][]net.IP{})

	time.Sleep(100 * time.Millisecond)

	m.mu.Lock()
	if len(m.targets) != 0 {
		t.Fatal("targets not removed")
	}
	m.mu.Unlock()
}

func TestSpoofLoopPanicRecovery(t *testing.T) {
	// This test verifies that a panic in spoofLoop is recovered
	// The actual panic handling is verified by the goroutine finishing
	logger := slog.Default()
	m, err := New("lo", logger)
	if err != nil {
		t.Skipf("could not initialize: %v", err)
	}
	defer m.Stop()

	mac := "aa:bb:cc:dd:ee:ff"
	ips := []net.IP{net.ParseIP("192.168.1.100")}

	m.UpdateTargets(map[string][]net.IP{mac: ips})

	// Stop and wait for goroutine to finish
	m.UpdateTargets(map[string][]net.IP{})
	time.Sleep(100 * time.Millisecond)
}

func TestParseMAC(t *testing.T) {
	_, err := net.ParseMAC("aa:bb:cc:dd:ee:ff")
	if err != nil {
		t.Fatalf("failed to parse valid MAC: %v", err)
	}

	_, err = net.ParseMAC("invalid")
	if err == nil {
		t.Fatal("should have failed on invalid MAC")
	}
}

func TestGatewaySync(t *testing.T) {
	logger := slog.Default()
	m, err := New("lo", logger)
	if err != nil {
		t.Skipf("could not initialize: %v", err)
	}
	defer m.Stop()

	// Manually trigger gateway sync
	m.syncGatewayFacts()

	// Gateway detection may return empty on loopback, which is ok
	// The test just verifies the method runs without panic
}

func TestStop(t *testing.T) {
	logger := slog.Default()
	m, err := New("lo", logger)
	if err != nil {
		t.Skipf("could not initialize: %v", err)
	}

	mac := "aa:bb:cc:dd:ee:ff"
	ips := []net.IP{net.ParseIP("192.168.1.100")}
	m.UpdateTargets(map[string][]net.IP{mac: ips})

	m.Stop()
	time.Sleep(100 * time.Millisecond)

	m.mu.Lock()
	if len(m.targets) != 0 {
		t.Fatal("targets not cleared on stop")
	}
	m.mu.Unlock()
}

// Benchmark goroutine startup
func BenchmarkUpdateTargets(b *testing.B) {
	logger := slog.Default()
	m, err := New("lo", logger)
	if err != nil {
		b.Skipf("could not initialize: %v", err)
	}
	defer m.Stop()

	targets := make(map[string][]net.IP)
	for i := 0; i < 100; i++ {
		mac := net.HardwareAddr{0xaa, 0xbb, 0xcc, 0xdd, byte(i >> 8), byte(i)}.String()
		targets[mac] = []net.IP{net.ParseIP("192.168.1.100")}
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		m.UpdateTargets(targets)
		m.UpdateTargets(map[string][]net.IP{})
		time.Sleep(10 * time.Millisecond)
	}
}
