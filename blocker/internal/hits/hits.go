package hits

import (
	"sync"
	"time"
)

// Tracker tracks hit rates per MAC (F46)
type Tracker struct {
	mu       sync.Mutex
	hits     map[string]*hitRecord // MAC -> hitRecord
	window   time.Duration
}

type hitRecord struct {
	count       int
	lastReset   time.Time
}

// New creates a new hits tracker with rate-limit window
func New(window time.Duration) *Tracker {
	return &Tracker{
		hits:   make(map[string]*hitRecord),
		window: window,
	}
}

// RecordHit records a hit for a MAC and returns true if within rate limit (F46)
// Rate limit is ≤1 hit per window duration
func (t *Tracker) RecordHit(mac string) bool {
	t.mu.Lock()
	defer t.mu.Unlock()

	now := time.Now()
	rec, exists := t.hits[mac]

	if !exists {
		t.hits[mac] = &hitRecord{
			count:     1,
			lastReset: now,
		}
		return true
	}

	// Check if window has expired
	if now.Sub(rec.lastReset) >= t.window {
		// Reset counter
		rec.count = 1
		rec.lastReset = now
		return true
	}

	// Within window - check if we can record another hit
	// F46: ≤1 hit per window
	if rec.count == 0 {
		rec.count++
		return true
	}

	return false
}

// GetHits returns current hit counts per MAC
func (t *Tracker) GetHits() map[string]int {
	t.mu.Lock()
	defer t.mu.Unlock()

	result := make(map[string]int)
	now := time.Now()

	for mac, rec := range t.hits {
		// Only include active hits (within window)
		if now.Sub(rec.lastReset) < t.window {
			result[mac] = rec.count
		}
	}

	return result
}

// Drain clears all hit counters (called on resist tick)
func (t *Tracker) Drain() {
	t.mu.Lock()
	defer t.mu.Unlock()

	t.hits = make(map[string]*hitRecord)
}

// DrainWindow drains old hits outside the window
func (t *Tracker) DrainWindow() {
	t.mu.Lock()
	defer t.mu.Unlock()

	now := time.Now()
	for mac, rec := range t.hits {
		if now.Sub(rec.lastReset) >= t.window {
			delete(t.hits, mac)
		}
	}
}
