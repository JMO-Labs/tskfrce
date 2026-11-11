package identity

import (
	"sync"
	"time"

	"github.com/jmo-labs/tskfrce/blocker/internal/backend"
)

const (
	addrTTL = 600 * time.Second
	maxStr  = 255
)

// Tracker manages device identity information with address freshness tracking
type Tracker struct {
	mu              sync.Mutex
	latest          map[string]*backend.Seen  // latest discovery result per MAC
	seenAt          map[string]time.Time      // when each MAC was last seen
	cache           map[string]map[string]*string // cached signals per MAC
	clock           func() time.Time
}

// NewTracker creates a new identity tracker
func NewTracker() *Tracker {
	return &Tracker{
		latest: make(map[string]*backend.Seen),
		seenAt: make(map[string]time.Time),
		cache:  make(map[string]map[string]*string),
		clock:  time.Now,
	}
}

// NoteSeen records a discovery result
func (t *Tracker) NoteSeen(seen *backend.Seen) {
	t.mu.Lock()
	defer t.mu.Unlock()

	t.latest[seen.MAC] = seen
	t.seenAt[seen.MAC] = t.clock()
}

// MACForIP returns the MAC holding an IP if known and fresh (F39)
func (t *Tracker) MACForIP(ip string) *string {
	cutoff := t.clock().Add(-addrTTL)

	t.mu.Lock()
	defer t.mu.Unlock()

	var result *string
	count := 0

	for mac, seen := range t.latest {
		if seen.IP != nil && *seen.IP == ip && t.seenAt[mac].After(cutoff) {
			result = &mac
			count++
		}
		for _, ipv6 := range seen.IPv6 {
			if ipv6 == ip && t.seenAt[mac].After(cutoff) {
				result = &mac
				count++
			}
		}
	}

	// Return only if exactly one MAC has this IP (F39)
	if count == 1 {
		return result
	}
	return nil
}

// Update caches new/changed signals and reports merged data
func (t *Tracker) Update(mac string, mdnsName, model, dhcpFP *string) bool {
	t.mu.Lock()
	defer t.mu.Unlock()

	base := t.latest[mac]
	if base == nil {
		// Only enrich devices discovery already knows
		return false
	}

	cached := t.cache[mac]
	if cached == nil {
		cached = make(map[string]*string)
		t.cache[mac] = cached
	}

	// Truncate strings to maxStr
	if mdnsName != nil && len(*mdnsName) > maxStr {
		s := (*mdnsName)[:maxStr]
		mdnsName = &s
	}
	if model != nil && len(*model) > maxStr {
		s := (*model)[:maxStr]
		model = &s
	}
	if dhcpFP != nil && len(*dhcpFP) > maxStr {
		s := (*dhcpFP)[:maxStr]
		dhcpFP = &s
	}

	// Check if anything changed
	changed := false
	if mdnsName != nil && cached["mdns_name"] != mdnsName {
		changed = true
		cached["mdns_name"] = mdnsName
	}
	if model != nil && cached["model"] != model {
		changed = true
		cached["model"] = model
	}
	if dhcpFP != nil && cached["dhcp_fp"] != dhcpFP {
		changed = true
		cached["dhcp_fp"] = dhcpFP
	}

	return changed
}

// ResolveMDNS attempts to get model from mDNS TXT records (F39)
func (t *Tracker) ResolveMDNS(mac string) *string {
	t.mu.Lock()
	defer t.mu.Unlock()

	seen := t.latest[mac]
	if seen == nil || seen.Vendor == nil {
		return nil
	}

	// Fallback to vendor if no model set
	return seen.Vendor
}
