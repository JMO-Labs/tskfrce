package hits

import (
	"testing"
	"time"
)

func TestNewTracker(t *testing.T) {
	tr := New(10 * time.Second)
	if tr == nil {
		t.Fatal("tracker is nil")
	}
	if tr.window != 10*time.Second {
		t.Fatalf("window not set: %v", tr.window)
	}
}

func TestRecordHitFirstTime(t *testing.T) {
	tr := New(10 * time.Second)
	mac := "aa:bb:cc:dd:ee:ff"

	result := tr.RecordHit(mac)
	if !result {
		t.Fatal("first hit should be recorded")
	}
}

func TestRecordHitRateLimit(t *testing.T) {
	tr := New(10 * time.Second)
	mac := "aa:bb:cc:dd:ee:ff"

	// First hit allowed
	if !tr.RecordHit(mac) {
		t.Fatal("first hit should be allowed")
	}

	// Second hit within window denied (F46: ≤1 per window)
	if tr.RecordHit(mac) {
		t.Fatal("second hit within window should be denied")
	}

	// Subsequent hits denied
	if tr.RecordHit(mac) {
		t.Fatal("third hit within window should be denied")
	}
}

func TestRecordHitWindowExpiration(t *testing.T) {
	tr := New(100 * time.Millisecond)
	mac := "aa:bb:cc:dd:ee:ff"

	// First hit
	if !tr.RecordHit(mac) {
		t.Fatal("first hit should be allowed")
	}

	// Second hit denied within window
	if tr.RecordHit(mac) {
		t.Fatal("second hit within window should be denied")
	}

	// Wait for window to expire
	time.Sleep(150 * time.Millisecond)

	// Now another hit should be allowed
	if !tr.RecordHit(mac) {
		t.Fatal("hit after window expiry should be allowed")
	}
}

func TestGetHits(t *testing.T) {
	tr := New(10 * time.Second)

	tr.RecordHit("aa:bb:cc:dd:ee:ff")
	tr.RecordHit("aa:bb:cc:dd:ee:00")

	hits := tr.GetHits()
	if len(hits) != 2 {
		t.Fatalf("expected 2 MACs with hits, got %d", len(hits))
	}

	if hits["aa:bb:cc:dd:ee:ff"] != 1 {
		t.Fatalf("expected 1 hit for first MAC")
	}
	if hits["aa:bb:cc:dd:ee:00"] != 1 {
		t.Fatalf("expected 1 hit for second MAC")
	}
}

func TestGetHitsExpired(t *testing.T) {
	tr := New(100 * time.Millisecond)

	tr.RecordHit("aa:bb:cc:dd:ee:ff")

	hits := tr.GetHits()
	if len(hits) != 1 {
		t.Fatalf("expected 1 MAC with hits before expiry")
	}

	time.Sleep(150 * time.Millisecond)

	hits = tr.GetHits()
	if len(hits) != 0 {
		t.Fatalf("expected 0 MACs with hits after expiry, got %d", len(hits))
	}
}

func TestDrain(t *testing.T) {
	tr := New(10 * time.Second)

	tr.RecordHit("aa:bb:cc:dd:ee:ff")
	tr.RecordHit("aa:bb:cc:dd:ee:00")

	hits := tr.GetHits()
	if len(hits) != 2 {
		t.Fatal("expected hits before drain")
	}

	tr.Drain()

	hits = tr.GetHits()
	if len(hits) != 0 {
		t.Fatalf("expected 0 hits after drain, got %d", len(hits))
	}
}

func TestDrainWindow(t *testing.T) {
	tr := New(100 * time.Millisecond)

	tr.RecordHit("aa:bb:cc:dd:ee:ff")

	time.Sleep(150 * time.Millisecond)

	tr.DrainWindow()

	hits := tr.GetHits()
	if len(hits) != 0 {
		t.Fatalf("expected expired hits to be drained, got %d", len(hits))
	}
}

func TestMultipleMACsIndependent(t *testing.T) {
	tr := New(10 * time.Second)

	mac1 := "aa:bb:cc:dd:ee:ff"
	mac2 := "aa:bb:cc:dd:ee:00"

	// Record hit for mac1
	if !tr.RecordHit(mac1) {
		t.Fatal("first hit for mac1 should be allowed")
	}

	// Second hit for mac1 denied
	if tr.RecordHit(mac1) {
		t.Fatal("second hit for mac1 should be denied")
	}

	// But first hit for mac2 should be allowed
	if !tr.RecordHit(mac2) {
		t.Fatal("first hit for mac2 should be allowed")
	}

	// Second hit for mac2 denied
	if tr.RecordHit(mac2) {
		t.Fatal("second hit for mac2 should be denied")
	}
}

// Benchmark hit recording
func BenchmarkRecordHit(b *testing.B) {
	tr := New(10 * time.Second)
	mac := "aa:bb:cc:dd:ee:ff"

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		tr.RecordHit(mac)
		if i%10 == 0 {
			tr.Drain()
		}
	}
}
