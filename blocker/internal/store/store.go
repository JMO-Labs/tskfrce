package store

import (
	"sync"
)

// Store holds the blocked MAC addresses and state
type Store struct {
	mu        sync.RWMutex
	blocked   map[string]bool // MAC -> bool
	listenOnly bool
	coveredVLANs []uint16
}

// New creates a new state store
func New() *Store {
	return &Store{
		blocked: make(map[string]bool),
	}
}

// SetBlocked updates the blocked MAC set
func (s *Store) SetBlocked(macs []string) error {
	// TODO: Implement with MAC validation and lowercasing (F21)
	return nil
}

// GetBlocked returns the current blocked set
func (s *Store) GetBlocked() []string {
	// TODO: Implement
	return nil
}

// SetListenOnly sets the listen_only flag
func (s *Store) SetListenOnly(lo bool) {
	// TODO: Implement
}

// GetListenOnly returns the current listen_only state
func (s *Store) GetListenOnly() bool {
	// TODO: Implement
	return false
}
