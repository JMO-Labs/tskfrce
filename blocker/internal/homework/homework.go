// Package homework implements homework mode per-device whitelisting with time windows.
package homework

import (
	"fmt"
	"strings"
	"sync"
	"time"
)

const (
	// MaxNamesPerList limits names in allow/block lists (H1)
	MaxNamesPerList = 1000
	// MaxNameLen limits individual domain name length (H1)
	MaxNameLen = 253
	// MinTimeout minimum pair timeout in seconds (H3)
	MinTimeout = 300
	// MaxTimeout maximum pair timeout in seconds (H3)
	MaxTimeout = 3600
	// ActivityChunkSize for POST /homework/activity batches (H5)
	ActivityChunkSize = 500
	// FollowWindowSecs gate follow window (H6)
	FollowWindowSecs = 10
	// MaxNamesPerSession cap on names tracked (H6)
	MaxNamesPerSession = 5000
)

// HomeworkState holds per-MAC homework mode rules (H1)
type HomeworkState struct {
	Allow []string  `json:"allow"`
	Block []string  `json:"block"`
	Until time.Time `json:"until"`
}

// ValidateHomeworkState checks list sizes and name lengths (H1)
func ValidateHomeworkState(hw *HomeworkState) error {
	if hw == nil {
		return nil
	}

	if len(hw.Allow) > MaxNamesPerList {
		return fmt.Errorf("allow list exceeds %d names", MaxNamesPerList)
	}
	if len(hw.Block) > MaxNamesPerList {
		return fmt.Errorf("block list exceeds %d names", MaxNamesPerList)
	}

	for _, name := range hw.Allow {
		if len(name) > MaxNameLen {
			return fmt.Errorf("allow name %q exceeds %d chars", name, MaxNameLen)
		}
	}
	for _, name := range hw.Block {
		if len(name) > MaxNameLen {
			return fmt.Errorf("block name %q exceeds %d chars", name, MaxNameLen)
		}
	}

	// Until must be in the future (when set)
	if !hw.Until.IsZero() && hw.Until.Before(time.Now()) {
		return fmt.Errorf("until timestamp is in the past")
	}

	return nil
}

// ParseUntil parses ISO 8601 timestamp with timezone to time.Time (H1)
func ParseUntil(until string) (time.Time, error) {
	// Accept RFC3339 format (ISO 8601 with timezone)
	t, err := time.Parse(time.RFC3339, until)
	if err != nil {
		return time.Time{}, fmt.Errorf("invalid until timestamp: %w", err)
	}
	if t.Location() == time.UTC && !strings.Contains(until, "Z") && !strings.Contains(until, "+") && !strings.Contains(until, "-00") {
		// Reject if parsed but no timezone indicator found
		return time.Time{}, fmt.Errorf("until timestamp must include timezone")
	}
	return t, nil
}

// Activity holds per-domain homework session activity
type Activity struct {
	MAC           string    `json:"mac"`
	Domain        string    `json:"domain"`
	Via           string    `json:"via"`  // "list" or "follow"
	PulledBy      *string   `json:"pulled_by,omitempty"`
	FirstSeen     time.Time `json:"first_seen"`
	LastSeen      time.Time `json:"last_seen"`
	Lookups       int       `json:"lookups"`
	ActiveMinutes int       `json:"active_minutes"`
}

// ChunkActivity splits activity list into chunks of ActivityChunkSize (H5)
func ChunkActivity(activities []Activity) [][]Activity {
	var chunks [][]Activity
	for i := 0; i < len(activities); i += ActivityChunkSize {
		end := i + ActivityChunkSize
		if end > len(activities) {
			end = len(activities)
		}
		chunks = append(chunks, activities[i:end])
	}
	return chunks
}

// TimeoutForPair clamps timeout to [MinTimeout, MaxTimeout], never past until (H3)
func TimeoutForPair(ttl int, now time.Time, until time.Time) int {
	// Clamp TTL to bounds
	timeout := ttl
	if timeout < MinTimeout {
		timeout = MinTimeout
	}
	if timeout > MaxTimeout {
		timeout = MaxTimeout
	}

	// Never extend past until
	if !until.IsZero() {
		secondsUntil := int(until.Sub(now).Seconds())
		if secondsUntil < 1 {
			secondsUntil = 1
		}
		if timeout > secondsUntil {
			timeout = secondsUntil
		}
	}

	if timeout < 1 {
		timeout = 1
	}
	return timeout
}

// SessionState tracks per-session follow-window state (H6)
type SessionState struct {
	LastAllowedName string    // Name of last allowed query (for gate follow)
	LastAllowedTime time.Time // Time of last allowed query (gate window reset)
	NamesSeen       int       // Total names seen this session (H6 cap: 5000)
}

// Manager implements homework decision logic per MAC (H2, H6)
type Manager struct {
	mu       sync.Mutex
	state    *HomeworkState // Current state: allow/block lists + until
	session  SessionState   // Gate follow state
	now      func() time.Time // For testing
}

// NewManager creates a homework manager (H1-H6)
func NewManager(hw *HomeworkState) *Manager {
	return &Manager{
		state: hw,
		now:   time.Now,
	}
}

// SetState updates the homework state (called on /state reconcile)
func (m *Manager) SetState(hw *HomeworkState) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.state = hw
}

// Decide evaluates if a domain name is allowed under homework mode (H2, H6)
// Returns (allowed, via) where via is "list" or "follow"; both reject if allowed=false
func (m *Manager) Decide(domain string) (allowed bool, via string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// No homework state → allow all
	if m.state == nil {
		return true, "none"
	}

	// Homework expired → allow all
	if !m.state.Until.IsZero() && m.now().After(m.state.Until) {
		return true, "none"
	}

	// Check block list FIRST (H6: blocked names denied even inside window)
	for _, blocked := range m.state.Block {
		if strings.EqualFold(domain, blocked) || strings.HasSuffix(domain, "."+blocked) {
			return false, "blocked"
		}
	}

	// Check allow list (H2: allowed names are always granted)
	for _, allowed := range m.state.Allow {
		if strings.EqualFold(domain, allowed) || strings.HasSuffix(domain, "."+allowed) {
			m.session.LastAllowedName = domain
			m.session.LastAllowedTime = m.now()
			m.session.NamesSeen++
			return true, "list"
		}
	}

	// Check follow window (H6: gate window 10s, cap 5000 names)
	if m.session.NamesSeen >= MaxNamesPerSession {
		return false, "cap_exceeded"
	}

	// Follow window: only if we've seen an allowed name AND within window
	if m.session.LastAllowedName != "" && m.now().Sub(m.session.LastAllowedTime) <= time.Duration(FollowWindowSecs)*time.Second {
		m.session.NamesSeen++
		return true, "follow"
	}

	// Name not in list and not in follow window
	return false, "unlisted"
}
