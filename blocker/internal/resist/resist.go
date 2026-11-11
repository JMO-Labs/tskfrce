package resist

import (
	"net"
	"sync"
	"time"
)

// Tally holds frame counts for one MAC in a window.
type Tally struct {
	ToBox       int
	FromGateway int
}

// tallyEntry stores a tally with its window start time.
type tallyEntry struct {
	start time.Time
	tally Tally
}

// Counter tracks resistance per MAC with windowed tallies.
type Counter struct {
	mu       sync.Mutex
	box      string
	gateways map[string]bool
	lanNets  []*net.IPNet
	window   float64
	thresh   int
	clock    func() time.Time
	watched  map[string]bool
	ip2mac   map[string]string
	tallies  map[string]tallyEntry
}

// NewCounter creates a resistance counter.
func NewCounter(boxMAC string, gatewayMACs []string, lanCIDRs []string, window float64, threshold int) *Counter {
	return newCounterWithClock(boxMAC, gatewayMACs, lanCIDRs, window, threshold, time.Now)
}

func newCounterWithClock(boxMAC string, gatewayMACs []string, lanCIDRs []string, window float64, threshold int, clock func() time.Time) *Counter {
	gw := make(map[string]bool)
	for _, m := range gatewayMACs {
		if m != "" {
			gw[canonicalize(m)] = true
		}
	}

	nets := make([]*net.IPNet, 0, len(lanCIDRs))
	for _, cidr := range lanCIDRs {
		_, n, err := net.ParseCIDR(cidr)
		if err == nil {
			nets = append(nets, n)
		}
	}

	return &Counter{
		box:      canonicalize(boxMAC),
		gateways: gw,
		lanNets:  nets,
		window:   window,
		thresh:   threshold,
		clock:    clock,
		watched:  make(map[string]bool),
		ip2mac:   make(map[string]string),
		tallies:  make(map[string]tallyEntry),
	}
}

// SetWatched replaces the watched set; old tallies are dropped.
func (c *Counter) SetWatched(targets map[string]string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	watched := make(map[string]bool)
	ip2mac := make(map[string]string)

	for mac := range targets {
		ml := canonicalize(mac)
		watched[ml] = true
		ip2mac[canonizeIP(targets[mac])] = ml
	}

	c.watched = watched
	c.ip2mac = ip2mac

	for mac := range c.tallies {
		if !watched[mac] {
			delete(c.tallies, mac)
		}
	}
}

// Reset drops one MAC's tally.
func (c *Counter) Reset(mac string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.tallies, canonicalize(mac))
}

// Observe counts one frame if relevant.
func (c *Counter) Observe(srcMAC, dstMAC, ipDst, ipSrc string) {
	src := canonicalize(srcMAC)
	dst := canonicalize(dstMAC)

	c.mu.Lock()
	defer c.mu.Unlock()

	if dst != c.box {
		return
	}

	now := c.clock()
	var mac string
	var field string

	if c.watched[src] {
		mac, field = src, "to_box"
	} else if c.gateways[src] && ipDst != "" && ipSrc != "" {
		ipDst = canonizeIP(ipDst)
		mac = c.ip2mac[ipDst]
		if mac != "" && !c.inLAN(ipSrc) {
			field = "from_gateway"
		}
	}

	if mac == "" {
		return
	}

	entry := c.tallies[mac]
	windowExpired := entry.start != (time.Time{}) && now.Sub(entry.start).Seconds() >= c.window
	if entry.start == (time.Time{}) || windowExpired {
		entry = tallyEntry{start: now}
	}

	if field == "to_box" {
		entry.tally.ToBox++
	} else if field == "from_gateway" {
		entry.tally.FromGateway++
	}

	c.tallies[mac] = entry
}

// Tally returns the current counts for a MAC.
func (c *Counter) Tally(mac string) Tally {
	c.mu.Lock()
	defer c.mu.Unlock()

	mac = canonicalize(mac)
	entry := c.tallies[mac]

	now := c.clock()
	if now.Sub(entry.start).Seconds() >= c.window {
		return Tally{}
	}

	return entry.tally
}

// Resisting returns MACs meeting the threshold.
func (c *Counter) Resisting() map[string]bool {
	c.mu.Lock()
	defer c.mu.Unlock()

	now := c.clock()
	result := make(map[string]bool)

	for mac := range c.watched {
		entry := c.tallies[mac]
		if now.Sub(entry.start).Seconds() < c.window && entry.tally.FromGateway >= c.thresh {
			result[mac] = true
		}
	}

	return result
}

func canonicalize(s string) string {
	hw, err := net.ParseMAC(s)
	if err != nil {
		return ""
	}
	return hw.String()
}

func canonizeIP(s string) string {
	ip := net.ParseIP(s)
	if ip != nil {
		return ip.String()
	}
	return ""
}

func (c *Counter) inLAN(ipStr string) bool {
	ip := net.ParseIP(ipStr)
	if ip == nil {
		return false
	}
	for _, n := range c.lanNets {
		if n.Contains(ip) {
			return true
		}
	}
	return false
}
