package backend

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/jmo-labs/tskfrce/blocker/internal/config"
)

const defaultTimeout = 5 * time.Second

// Client calls the backend API (F9)
type Client struct {
	cfg        *config.Config
	httpClient *http.Client
	baseURL    string
	logger     *slog.Logger
}

// New creates a new backend client
func New(cfg *config.Config) *Client {
	return &Client{
		cfg: cfg,
		httpClient: &http.Client{
			Timeout: defaultTimeout,
		},
		baseURL: strings.TrimSuffix(cfg.BackendURL, "/") + "/api/v1/internal",
		logger:  slog.Default(),
	}
}

// State is the response from backend /state (F11)
type State struct {
	Blocked      []string      `json:"blocked"`
	ListenOnly   bool          `json:"listen_only"`
	CoveredVLANs []uint16      `json:"covered_vlans"`
	Homework     interface{}   `json:"homework,omitempty"` // H1: homework state
}

// GetState fetches the current blocked/listen_only state from backend (F11)
// Unreachable/malformed -> return nil, no error (best-effort; F9)
func (c *Client) GetState(ctx context.Context) (*State, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", c.baseURL+"/state", nil)
	if err != nil {
		c.logger.Error("failed to create request", "error", err)
		return nil, nil
	}
	req.Header.Set("X-Internal-Token", c.cfg.InternalToken)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		c.logger.Error("backend unreachable", "error", err)
		return nil, nil
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		c.logger.Error("backend error", "status", resp.StatusCode)
		return nil, nil
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		c.logger.Error("failed to read response", "error", err)
		return nil, nil
	}

	state := &State{
		CoveredVLANs: []uint16{},  // Default empty
		Homework:     map[string]interface{}{}, // Default empty
	}
	if err := json.Unmarshal(body, state); err != nil {
		c.logger.Error("failed to parse state", "error", err)
		return nil, nil
	}

	return state, nil
}

// ReportResisting sends the current resisting device set to backend (F12)
// Sent even when empty (heartbeat)
func (c *Client) ReportResisting(ctx context.Context, macs []string) error {
	// Sort MACs for consistency
	sort.Strings(macs)

	payload := map[string][]string{
		"resisting": macs,
	}

	return c.post(ctx, "/devices/resisting", payload)
}

// ReportHits sends blocked device access attempts to backend (F13)
// Only non-empty
func (c *Client) ReportHits(ctx context.Context, hits map[string]int) error {
	if len(hits) == 0 {
		return nil
	}

	payload := map[string]interface{}{
		"hits": hits,
	}

	return c.post(ctx, "/devices/hits", payload)
}

// ReportWorkarounds sends discovered workarounds (F13)
// Only non-empty
func (c *Client) ReportWorkarounds(ctx context.Context, found map[string][]string) error {
	if len(found) == 0 {
		return nil
	}

	// Sort categories within each MAC
	sorted := make(map[string][]string)
	for mac, cats := range found {
		catsCopy := make([]string, len(cats))
		copy(catsCopy, cats)
		sort.Strings(catsCopy)
		sorted[mac] = catsCopy
	}

	payload := map[string]interface{}{
		"found": sorted,
	}

	return c.post(ctx, "/devices/workarounds", payload)
}

// ReportSeen reports a device discovery (F10)
func (c *Client) ReportSeen(ctx context.Context, seen *Seen) (int, error) {
	body, err := json.Marshal(seen)
	if err != nil {
		c.logger.Error("failed to marshal seen", "error", err)
		return 0, nil
	}

	req, err := http.NewRequestWithContext(ctx, "POST", c.baseURL+"/devices/seen", bytes.NewReader(body))
	if err != nil {
		c.logger.Error("failed to create request", "error", err)
		return 0, nil
	}
	req.Header.Set("X-Internal-Token", c.cfg.InternalToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		c.logger.Error("backend unreachable", "error", err)
		return 0, nil
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		c.logger.Error("backend error", "status", resp.StatusCode)
		return 0, nil
	}

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		c.logger.Error("failed to read response", "error", err)
		return 0, nil
	}

	var result map[string]interface{}
	if err := json.Unmarshal(respBody, &result); err != nil {
		c.logger.Error("failed to parse response", "error", err)
		return 0, nil
	}

	if id, ok := result["id"].(float64); ok {
		return int(id), nil
	}

	return 0, nil
}

// ReportVLANs sends VLAN information to backend (F14)
// Only non-empty every 60s
func (c *Client) ReportVLANs(ctx context.Context, vlans []map[string]interface{}) error {
	if len(vlans) == 0 {
		return nil
	}

	payload := map[string]interface{}{
		"vlans": vlans,
	}

	return c.post(ctx, "/vlans", payload)
}

// Seen represents device discovery information (F10)
type Seen struct {
	MAC      string   `json:"mac"`
	IP       *string  `json:"ip"`
	IPv6     []string `json:"ipv6"`
	Hostname *string  `json:"hostname"`
	Vendor   *string  `json:"vendor"`
	MDNSName *string  `json:"mdns_name,omitempty"`    // F10: omitted when nil
	Model    *string  `json:"model,omitempty"`        // F10: omitted when nil
	DHCPFP   *string  `json:"dhcp_fp,omitempty"`      // F10: omitted when nil
	VID      *uint16  `json:"vid,omitempty"`          // F10: omitted when nil (backend keeps old)
}

// post is a helper to send POST requests with best-effort error handling (F9)
func (c *Client) post(ctx context.Context, path string, payload interface{}) error {
	body, err := json.Marshal(payload)
	if err != nil {
		c.logger.Error("failed to marshal payload", "error", err)
		return nil // Best-effort: log and continue
	}

	req, err := http.NewRequestWithContext(ctx, "POST", c.baseURL+path, bytes.NewReader(body))
	if err != nil {
		c.logger.Error("failed to create request", "error", err)
		return nil
	}
	req.Header.Set("X-Internal-Token", c.cfg.InternalToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		// Check if it's a timeout
		if isTimeout(err) {
			c.logger.Error("backend request timeout", "path", path)
		} else {
			c.logger.Error("backend error", "path", path, "error", err)
		}
		return nil // Best-effort: log and continue
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		c.logger.Error("backend error", "path", path, "status", resp.StatusCode)
	}

	return nil // Always return nil (best-effort)
}

// isTimeout checks if an error is a timeout
func isTimeout(err error) bool {
	if err == nil {
		return false
	}
	// Check for net.Error with Timeout()
	if ne, ok := err.(net.Error); ok && ne.Timeout() {
		return true
	}
	// Check for context deadline
	if err == context.DeadlineExceeded {
		return true
	}
	// Check for URL error wrapping timeout
	if ue, ok := err.(*url.Error); ok {
		return ue.Timeout()
	}
	return false
}
