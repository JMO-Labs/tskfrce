package backend

import (
	"context"

	"github.com/jmo-labs/tskfrce/blocker/internal/config"
)

// Client calls the backend API
type Client struct {
	cfg *config.Config
	// TODO: HTTP client field
}

// New creates a new backend client
func New(cfg *config.Config) *Client {
	return &Client{cfg: cfg}
}

// GetState fetches the current blocked/listen_only state from backend
func (c *Client) GetState(ctx context.Context) (*State, error) {
	// TODO: Implement F11 GET /api/v1/internal/state
	return nil, nil
}

// ReportResisting sends the current resisting device set to backend
func (c *Client) ReportResisting(ctx context.Context, macs []string) error {
	// TODO: Implement F12 POST /api/v1/internal/devices/resisting
	return nil
}

// ReportHits sends blocked device access attempts to backend
func (c *Client) ReportHits(ctx context.Context, hits map[string]int) error {
	// TODO: Implement F13 POST /api/v1/internal/devices/hits
	return nil
}

// ReportWorkarounds sends discovered workarounds
func (c *Client) ReportWorkarounds(ctx context.Context, found map[string][]string) error {
	// TODO: Implement F13 POST /api/v1/internal/devices/workarounds
	return nil
}

// State is the response from backend /state
type State struct {
	Blocked      []string   `json:"blocked"`
	ListenOnly   bool       `json:"listen_only"`
	CoveredVLANs []uint16   `json:"covered_vlans"`
	Homework     interface{} `json:"homework,omitempty"` // H1: homework state
}
