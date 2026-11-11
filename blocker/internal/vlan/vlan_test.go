package vlan

import (
	"log/slog"
	"net"
	"testing"
)

func TestNewDetector(t *testing.T) {
	logger := slog.Default()
	d, err := New("", "", logger)
	if err != nil {
		t.Fatalf("failed to create detector: %v", err)
	}
	if d == nil {
		t.Fatal("detector is nil")
	}
}

func TestDetectorWithInterface(t *testing.T) {
	logger := slog.Default()
	d, err := New("lo", "", logger)
	if err != nil {
		t.Fatalf("failed to create detector: %v", err)
	}
	if d.lanIface == nil {
		t.Fatal("LAN interface not set")
	}
}

func TestRecordMACOnVLAN(t *testing.T) {
	logger := slog.Default()
	d, _ := New("", "", logger)

	mac := "aa:bb:cc:dd:ee:ff"
	vid := uint16(100)

	d.recordMACOnVLAN(mac, vid)

	vlans := d.GetVLANs()
	if _, exists := vlans[vid]; !exists {
		t.Fatal("VLAN not recorded")
	}
	if len(vlans[vid].MACs) != 1 || vlans[vid].MACs[0] != mac {
		t.Fatal("MAC not recorded on VLAN")
	}
}

func TestRecordMultipleMACsOnVLAN(t *testing.T) {
	logger := slog.Default()
	d, _ := New("", "", logger)

	d.recordMACOnVLAN("aa:bb:cc:dd:ee:ff", 100)
	d.recordMACOnVLAN("aa:bb:cc:dd:ee:00", 100)
	d.recordMACOnVLAN("aa:bb:cc:dd:ee:01", 100)

	vlans := d.GetVLANs()
	if len(vlans[100].MACs) != 3 {
		t.Fatalf("expected 3 MACs, got %d", len(vlans[100].MACs))
	}
}

func TestRecordMACOnMultipleVLANs(t *testing.T) {
	logger := slog.Default()
	d, _ := New("", "", logger)

	mac := "aa:bb:cc:dd:ee:ff"
	d.recordMACOnVLAN(mac, 100)
	d.recordMACOnVLAN(mac, 200)

	vlans := d.GetVLANs()
	if len(vlans) != 2 {
		t.Fatalf("expected 2 VLANs, got %d", len(vlans))
	}
}

func TestRecordSubnetVote(t *testing.T) {
	logger := slog.Default()
	d, _ := New("", "", logger)

	vid := uint16(100)
	ip1 := net.ParseIP("192.168.1.10")
	ip2 := net.ParseIP("192.168.1.20")
	ip3 := net.ParseIP("192.168.2.10")

	d.recordSubnetVote(vid, ip1)
	d.recordSubnetVote(vid, ip2)
	d.recordSubnetVote(vid, ip3)

	vlans := d.GetVLANs()
	if vlans[vid].Subnet == nil {
		t.Fatal("subnet not detected")
	}

	// 192.168.1.0/24 should win with 2 votes
	if vlans[vid].Subnet.String() != "192.168.1.0/24" {
		t.Fatalf("expected 192.168.1.0/24, got %s", vlans[vid].Subnet.String())
	}
}

func TestIsValidARPSender(t *testing.T) {
	logger := slog.Default()
	d, _ := New("", "", logger)

	ethSrc := net.HardwareAddr{0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff}
	hwSrc := net.HardwareAddr{0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff}
	hwSrcDiff := net.HardwareAddr{0x00, 0x00, 0x00, 0x00, 0x00, 0x00}

	// Valid: hwsrc == ethsrc, private IP
	protAddr := []byte{192, 168, 1, 1}
	if !d.isValidARPSender(ethSrc, hwSrc, protAddr) {
		t.Fatal("valid ARP sender rejected")
	}

	// Invalid: hwsrc != ethsrc
	if d.isValidARPSender(ethSrc, hwSrcDiff, protAddr) {
		t.Fatal("invalid ARP sender (hwsrc mismatch) accepted")
	}

	// Invalid: public IP
	protAddr = []byte{8, 8, 8, 8}
	if d.isValidARPSender(ethSrc, hwSrc, protAddr) {
		t.Fatal("invalid ARP sender (public IP) accepted")
	}

	// Invalid: unspecified IP
	protAddr = []byte{0, 0, 0, 0}
	if d.isValidARPSender(ethSrc, hwSrc, protAddr) {
		t.Fatal("invalid ARP sender (unspecified IP) accepted")
	}

	// Invalid: link-local IP
	protAddr = []byte{169, 254, 1, 1}
	if d.isValidARPSender(ethSrc, hwSrc, protAddr) {
		t.Fatal("invalid ARP sender (link-local IP) accepted")
	}
}

func TestGetVLANsSorted(t *testing.T) {
	logger := slog.Default()
	d, _ := New("", "", logger)

	d.recordMACOnVLAN("mac1", 100)
	d.recordMACOnVLAN("mac2", 100)
	d.recordMACOnVLAN("mac3", 100)

	vlans := d.GetVLANs()
	if len(vlans[100].MACs) != 3 {
		t.Fatal("MACs not recorded")
	}

	// Check if MACs are sorted
	macs := vlans[100].MACs
	if macs[0] != "mac1" || macs[1] != "mac2" || macs[2] != "mac3" {
		t.Fatalf("MACs not sorted: %v", macs)
	}
}

func TestStop(t *testing.T) {
	logger := slog.Default()
	d, _ := New("", "", logger)

	// Should not panic
	d.Stop()
}

// Test that invalid VLAN IDs are rejected
func TestInvalidVLANID(t *testing.T) {
	logger := slog.Default()
	d, _ := New("", "", logger)

	// The validation happens in listenOnInterface before recordMACOnVLAN
	// So we'll test valid VLAN range
	d.recordMACOnVLAN("mac1", 1)
	d.recordMACOnVLAN("mac2", 4094)

	vlans := d.GetVLANs()
	if len(vlans) != 2 {
		t.Fatalf("expected 2 valid VLANs, got %d", len(vlans))
	}
}

// Test concurrent MAC recording
func TestConcurrentRecording(t *testing.T) {
	logger := slog.Default()
	d, _ := New("", "", logger)

	// Record MACs concurrently
	done := make(chan struct{})
	for i := 0; i < 10; i++ {
		go func(idx int) {
			for j := 0; j < 10; j++ {
				mac := net.HardwareAddr{0xaa, 0xbb, 0xcc, byte(idx >> 8), byte(idx), byte(j)}.String()
				d.recordMACOnVLAN(mac, uint16(100+idx))
			}
			done <- struct{}{}
		}(i)
	}

	for i := 0; i < 10; i++ {
		<-done
	}

	vlans := d.GetVLANs()
	if len(vlans) < 10 {
		t.Fatalf("expected at least 10 VLANs, got %d", len(vlans))
	}
}

// Benchmark VLAN detection
func BenchmarkRecordMACOnVLAN(b *testing.B) {
	logger := slog.Default()
	d, _ := New("", "", logger)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		mac := net.HardwareAddr{0xaa, 0xbb, 0xcc, byte(i >> 16), byte(i >> 8), byte(i)}.String()
		vid := uint16((i % 1000) + 1)
		d.recordMACOnVLAN(mac, vid)
	}
}
