package signals

import (
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jmo-labs/tskfrce/blocker/internal/backend"
)

const (
	dhcpFreshness = 600 * time.Second
	mdnsQueryEvery = 300 * time.Second
)

// Collector passively collects device signals
type Collector struct {
	mu       sync.Mutex
	latest   map[string]*backend.Seen // last discovery result per MAC
	seenAt   map[string]time.Time      // when each MAC was last seen
	cache    map[string]map[string]*string // cached signals per MAC
	clock    func() time.Time
}

// NewCollector creates a new signal collector
func NewCollector() *Collector {
	return &Collector{
		latest: make(map[string]*backend.Seen),
		seenAt: make(map[string]time.Time),
		cache:  make(map[string]map[string]*string),
		clock:  time.Now,
	}
}

// NoteSeen records a discovery result
func (c *Collector) NoteSeen(seen *backend.Seen) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.latest[seen.MAC] = seen
	c.seenAt[seen.MAC] = c.clock()
}

// DHCPFingerprint extracts fingerprint from DHCP packet
// Returns (MAC, fingerprint) or (nil, nil) on failure (F40)
func DHCPFingerprint(packet []byte) (string, string, error) {
	// TODO: Parse DHCP BOOTREQUEST, extract option 55 (param_req_list)
	// Fingerprint = comma-joined option numbers in order
	// Validate: chaddr[:6] == ether src
	return "", "", fmt.Errorf("not implemented")
}

// MDNSParse extracts device info from mDNS response
// Returns (MAC, hostname, model) or (nil, nil, nil) on failure (F42)
func MDNSParse(packet []byte) (string, string, *string, error) {
	// TODO: Parse mDNS response:
	// - A record matches packet IP source
	// - Single MAC seen for IP within 600s == ether src
	// - Model from TXT record: model=... or md=...
	return "", "", nil, fmt.Errorf("not implemented")
}

// MACForIP returns the MAC holding an IP if known and fresh
func (c *Collector) MACForIP(ip string) *string {
	cutoff := c.clock().Add(-dhcpFreshness)

	c.mu.Lock()
	defer c.mu.Unlock()

	var result *string
	count := 0

	for mac, seen := range c.latest {
		if seen.IP != nil && *seen.IP == ip && c.seenAt[mac].After(cutoff) {
			result = &mac
			count++
		}
		for _, ipv6 := range seen.IPv6 {
			if ipv6 == ip && c.seenAt[mac].After(cutoff) {
				result = &mac
				count++
			}
		}
	}

	// Return only if exactly one MAC has this IP
	if count == 1 {
		return result
	}
	return nil
}

// UpdateSignal caches new/changed signals
func (c *Collector) UpdateSignal(mac string, mdnsName, model, dhcpFP *string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()

	base := c.latest[mac]
	if base == nil {
		// Only enrich devices discovery already knows
		return false
	}

	cached := c.cache[mac]
	if cached == nil {
		cached = make(map[string]*string)
		c.cache[mac] = cached
	}

	// Check if anything new/changed
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

// MDNSGenerateQuery builds a raw mDNS PTR query (F41)
// Never binds :5353 to avoid avahi clash
func MDNSGenerateQuery() ([]byte, error) {
	// TODO: Generate raw L3 frame with multicast
	// - IP dst 224.0.0.251, ttl 255
	// - UDP sport/dport 5353
	// - DNS PTR queries for _device-info._tcp, _companion-link._tcp, _airplay._tcp
	return nil, fmt.Errorf("not implemented")
}

// formatDHCPFingerprint joins option numbers with commas
func formatDHCPFingerprint(optNums []byte) string {
	parts := make([]string, len(optNums))
	for i, num := range optNums {
		parts[i] = strconv.Itoa(int(num))
	}
	return strings.Join(parts, ",")
}
