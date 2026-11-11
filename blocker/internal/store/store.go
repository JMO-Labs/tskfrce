package store

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/jmo-labs/tskfrce/blocker/internal/homework"
)

var macRE = regexp.MustCompile(`^([0-9a-f]{2}:){5}[0-9a-f]{2}$`)

// Store holds the blocked MAC addresses and state
type Store struct {
	mu           sync.RWMutex
	blocked      map[string]bool                  // MAC -> bool (key is lowercase)
	listenOnly   bool
	coveredVLANs []uint16
	homework     map[string]*homework.HomeworkState // MAC -> HomeworkState
}

// New creates a new state store
func New() *Store {
	return &Store{
		blocked:      make(map[string]bool),
		coveredVLANs: []uint16{},
		homework:     make(map[string]*homework.HomeworkState),
	}
}

// SetBlocked updates the blocked MAC set with validation and lowercasing
func (s *Store) SetBlocked(macs []string) error {
	// Validate all MACs before any store update (F21)
	normalized := make(map[string]bool)
	for _, mac := range macs {
		// Lowercase and trim
		mac = strings.TrimSpace(strings.ToLower(mac))

		// Validate format
		if !macRE.MatchString(mac) {
			return fmt.Errorf("'%s' is not a valid MAC address", mac)
		}

		normalized[mac] = true
	}

	// Update store with validated MACs
	s.mu.Lock()
	s.blocked = normalized
	s.mu.Unlock()

	return nil
}

// GetBlocked returns the current blocked set as a sorted slice
func (s *Store) GetBlocked() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make([]string, 0, len(s.blocked))
	for mac := range s.blocked {
		result = append(result, mac)
	}
	sort.Strings(result)
	return result
}

// SetListenOnly sets the listen_only flag
func (s *Store) SetListenOnly(lo bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.listenOnly = lo
}

// GetListenOnly returns the current listen_only state
func (s *Store) GetListenOnly() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.listenOnly
}

// SetCoveredVLANs sets the list of covered VLAN IDs
func (s *Store) SetCoveredVLANs(vlans []uint16) {
	s.mu.Lock()
	defer s.mu.Unlock()
	// Copy the slice to prevent external modification
	s.coveredVLANs = make([]uint16, len(vlans))
	copy(s.coveredVLANs, vlans)
}

// GetCoveredVLANs returns the current covered VLANs
func (s *Store) GetCoveredVLANs() []uint16 {
	s.mu.RLock()
	defer s.mu.RUnlock()
	// Return a copy to prevent external modification
	result := make([]uint16, len(s.coveredVLANs))
	copy(result, s.coveredVLANs)
	return result
}

// SetHomework updates homework state for a MAC with validation (H1)
func (s *Store) SetHomework(mac string, hw *homework.HomeworkState) error {
	// Validate MAC
	mac = strings.TrimSpace(strings.ToLower(mac))
	if !macRE.MatchString(mac) {
		return fmt.Errorf("'%s' is not a valid MAC address", mac)
	}

	// Validate homework state
	if hw != nil {
		if err := homework.ValidateHomeworkState(hw); err != nil {
			return err
		}
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if hw == nil || hw.Until.Before(time.Now()) {
		delete(s.homework, mac)
	} else {
		s.homework[mac] = hw
	}
	return nil
}

// GetHomework returns the current homework state for a MAC
func (s *Store) GetHomework(mac string) *homework.HomeworkState {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.homework[mac]
}

// GetAllHomework returns all active homework states (H1)
func (s *Store) GetAllHomework() map[string]*homework.HomeworkState {
	s.mu.RLock()
	defer s.mu.RUnlock()
	// Return a copy to prevent external modification
	result := make(map[string]*homework.HomeworkState)
	for mac, hw := range s.homework {
		result[mac] = hw
	}
	return result
}
