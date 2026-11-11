package signals

import (
	"testing"

	"github.com/jmo-labs/tskfrce/blocker/internal/backend"
)

func TestNewCollector(t *testing.T) {
	c := NewCollector()
	if c == nil {
		t.Error("NewCollector returned nil")
	}
}

func TestNoteSeen(t *testing.T) {
	c := NewCollector()
	ip := "10.0.0.5"
	seen := &backend.Seen{
		MAC: "aa:bb:cc:dd:ee:01",
		IP:  &ip,
	}
	c.NoteSeen(seen)

	// Check that the seen was recorded
	c.mu.Lock()
	recorded := c.latest[seen.MAC]
	c.mu.Unlock()

	if recorded == nil || recorded.IP != seen.IP {
		t.Error("NoteSeen failed to record")
	}
}

func TestMACForIPFresh(t *testing.T) {
	c := NewCollector()
	ip := "10.0.0.5"
	mac := "aa:bb:cc:dd:ee:01"
	seen := &backend.Seen{
		MAC: mac,
		IP:  &ip,
	}
	c.NoteSeen(seen)

	found := c.MACForIP(ip)
	if found == nil || *found != mac {
		t.Errorf("MACForIP = %v, want %s", found, mac)
	}
}

func TestMACForIPAmbiguous(t *testing.T) {
	c := NewCollector()
	ip := "10.0.0.5"
	seen1 := &backend.Seen{
		MAC: "aa:bb:cc:dd:ee:01",
		IP:  &ip,
	}
	seen2 := &backend.Seen{
		MAC: "aa:bb:cc:dd:ee:02",
		IP:  &ip,
	}
	c.NoteSeen(seen1)
	c.NoteSeen(seen2)

	found := c.MACForIP(ip)
	if found != nil {
		t.Errorf("MACForIP should return nil for ambiguous IP, got %v", found)
	}
}

func TestUpdateSignalNewSignal(t *testing.T) {
	c := NewCollector()
	ip := "10.0.0.5"
	mac := "aa:bb:cc:dd:ee:01"
	seen := &backend.Seen{
		MAC: mac,
		IP:  &ip,
	}
	c.NoteSeen(seen)

	fp := "1,3,6"
	changed := c.UpdateSignal(mac, nil, nil, &fp)
	if !changed {
		t.Error("UpdateSignal should return true for new signal")
	}

	// Check that second update with same signal returns false
	changed = c.UpdateSignal(mac, nil, nil, &fp)
	if changed {
		t.Error("UpdateSignal should return false for unchanged signal")
	}
}

func TestUpdateSignalUnknownMAC(t *testing.T) {
	c := NewCollector()

	fp := "1,3,6"
	changed := c.UpdateSignal("aa:bb:cc:dd:ee:99", nil, nil, &fp)
	if changed {
		t.Error("UpdateSignal should return false for unknown MAC")
	}
}

func TestFormatDHCPFingerprint(t *testing.T) {
	optNums := []byte{1, 121, 3, 6}
	fp := formatDHCPFingerprint(optNums)
	expected := "1,121,3,6"
	if fp != expected {
		t.Errorf("formatDHCPFingerprint = %s, want %s", fp, expected)
	}
}
