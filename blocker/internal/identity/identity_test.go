package identity

import (
	"testing"
	"time"

	"github.com/jmo-labs/tskfrce/blocker/internal/backend"
)

func TestNewTracker(t *testing.T) {
	tr := NewTracker()
	if tr == nil {
		t.Error("NewTracker returned nil")
	}
}

func TestNoteSeen(t *testing.T) {
	tr := NewTracker()
	ip := "10.0.0.5"
	seen := &backend.Seen{
		MAC: "aa:bb:cc:dd:ee:01",
		IP:  &ip,
	}
	tr.NoteSeen(seen)

	// Check that the seen was recorded
	tr.mu.Lock()
	recorded := tr.latest[seen.MAC]
	tr.mu.Unlock()

	if recorded == nil || recorded.IP != seen.IP {
		t.Error("NoteSeen failed to record")
	}
}

func TestMACForIPFresh(t *testing.T) {
	tr := NewTracker()
	ip := "10.0.0.5"
	mac := "aa:bb:cc:dd:ee:01"
	seen := &backend.Seen{
		MAC: mac,
		IP:  &ip,
	}
	tr.NoteSeen(seen)

	found := tr.MACForIP(ip)
	if found == nil || *found != mac {
		t.Errorf("MACForIP = %v, want %s", found, mac)
	}
}

func TestMACForIPStale(t *testing.T) {
	tr := NewTracker()
	oldTime := time.Now().Add(-addrTTL - 1*time.Second)
	tr.clock = func() time.Time { return oldTime }

	ip := "10.0.0.5"
	seen := &backend.Seen{
		MAC: "aa:bb:cc:dd:ee:01",
		IP:  &ip,
	}
	tr.NoteSeen(seen)

	// Reset clock to now
	tr.clock = time.Now

	found := tr.MACForIP(ip)
	if found != nil {
		t.Errorf("MACForIP should return nil for stale entry, got %v", found)
	}
}

func TestMACForIPAmbiguous(t *testing.T) {
	tr := NewTracker()
	ip := "10.0.0.5"
	seen1 := &backend.Seen{
		MAC: "aa:bb:cc:dd:ee:01",
		IP:  &ip,
	}
	seen2 := &backend.Seen{
		MAC: "aa:bb:cc:dd:ee:02",
		IP:  &ip,
	}
	tr.NoteSeen(seen1)
	tr.NoteSeen(seen2)

	found := tr.MACForIP(ip)
	if found != nil {
		t.Errorf("MACForIP should return nil for ambiguous IP, got %v", found)
	}
}

func TestUpdateNewSignal(t *testing.T) {
	tr := NewTracker()
	ip := "10.0.0.5"
	mac := "aa:bb:cc:dd:ee:01"
	seen := &backend.Seen{
		MAC: mac,
		IP:  &ip,
	}
	tr.NoteSeen(seen)

	model := "TestModel"
	changed := tr.Update(mac, nil, &model, nil)
	if !changed {
		t.Error("Update should return true for new signal")
	}

	// Check that second update with same signal returns false
	changed = tr.Update(mac, nil, &model, nil)
	if changed {
		t.Error("Update should return false for unchanged signal")
	}
}

func TestUpdateUnknownMAC(t *testing.T) {
	tr := NewTracker()

	model := "TestModel"
	changed := tr.Update("aa:bb:cc:dd:ee:99", nil, &model, nil)
	if changed {
		t.Error("Update should return false for unknown MAC")
	}
}

func TestUpdateStringTruncation(t *testing.T) {
	tr := NewTracker()
	ip := "10.0.0.5"
	mac := "aa:bb:cc:dd:ee:01"
	seen := &backend.Seen{
		MAC: mac,
		IP:  &ip,
	}
	tr.NoteSeen(seen)

	longModel := string(make([]byte, maxStr+100))
	for i := range longModel {
		longModel = longModel[:i] + "x"
	}

	tr.Update(mac, nil, &longModel, nil)

	// Check that it was stored truncated
	tr.mu.Lock()
	stored := tr.cache[mac]["model"]
	tr.mu.Unlock()

	if stored != nil && len(*stored) > maxStr {
		t.Errorf("Model not truncated: %d > %d", len(*stored), maxStr)
	}
}
