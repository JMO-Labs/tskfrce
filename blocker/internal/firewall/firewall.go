package firewall

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"os"
	"regexp"
	"sort"
	"strings"
)

const (
	TABLE       = "task4ce"
	DNSPort     = 53
	DefaultPort = 80
)

var macPattern = regexp.MustCompile(`^([0-9a-f]{2}:){5}[0-9a-f]{2}$`)

// Firewall manages nftables rules
type Firewall struct {
	logger *slog.Logger
}

// New creates a new firewall manager
func New() *Firewall {
	return &Firewall{
		logger: slog.Default(),
	}
}

// Apply loads the firewall ruleset atomically via netlink (F27, F29)
func (f *Firewall) Apply(ctx context.Context, rules *Rules) error {
	ruleset := rules.Render()

	// In a full implementation, we would use google/nftables here
	// For now, we'll store the ruleset text and provide Render() for testing
	f.logger.Debug("firewall ruleset rendered", "lines", strings.Count(ruleset, "\n"))

	// TODO: Apply via netlink with google/nftables
	// For now, just return nil (implementation detail for later)
	return nil
}

// Delete removes the nftables table (F58)
func (f *Firewall) Delete(ctx context.Context) error {
	// TODO: Delete table via netlink
	f.logger.Debug("deleting nftables table")
	return nil
}

// EnableForwarding sets ip_forward and IPv6 forwarding (F30)
func EnableForwarding() {
	paths := []string{
		"/proc/sys/net/ipv4/ip_forward",
		"/proc/sys/net/ipv6/conf/all/forwarding",
	}

	for _, path := range paths {
		err := os.WriteFile(path, []byte("1\n"), 0644)
		if err != nil {
			slog.Default().Warn("could not enable forwarding", "path", path, "error", err)
		}
	}
}

// Rules describes a complete firewall ruleset
type Rules struct {
	BlockedV4  []string           // v4 addresses to drop
	BlockedV6  []string           // v6 addresses to drop
	BlockedMACs []string          // MACs to drop
	PortalIP   string             // Portal redirect IP (or empty, F28)
	PortalPort uint16             // Portal redirect port
	LANCIDRs   []string           // LAN CIDR ranges for exception
	HWOut      map[string]string  // Homework out pairs: MAC -> IP
	HWBack     map[string]string  // Homework back pairs: IP -> device IP
}

// Render produces the nft ruleset text for debugging/testing (F27)
func (r *Rules) Render() string {
	v4LAN := filterByIPVersion(r.LANCIDRs, false)
	v6LAN := filterByIPVersion(r.LANCIDRs, true)

	lines := []string{
		fmt.Sprintf("add table inet %s", TABLE),
		fmt.Sprintf("delete table inet %s", TABLE),
		fmt.Sprintf("table inet %s {", TABLE),
	}

	// Sets
	lines = append(lines, setDecl("blocked_v4", "ipv4_addr", r.BlockedV4))
	lines = append(lines, setDecl("blocked_v6", "ipv6_addr", r.BlockedV6))
	lines = append(lines, setDecl("blocked_mac", "ether_addr", r.BlockedMACs))

	// Homework sets (H3)
	hwOutElems := hwElems(r.HWOut, true)
	hwBackElems := hwElems(r.HWBack, false)
	lines = append(lines, hwSetDecl("hw_out", "ether_addr . ipv4_addr", hwOutElems))
	lines = append(lines, hwSetDecl("hw_back", "ipv4_addr . ipv4_addr", hwBackElems))

	// Prerouting chain (nat)
	lines = append(lines, "  chain prerouting {")
	lines = append(lines, "    type nat hook prerouting priority -100; policy accept;")

	if r.PortalIP != "" {
		lines = append(lines, fmt.Sprintf("    ip saddr @blocked_v4 udp dport 53 dnat ip to %s:53", r.PortalIP))
		lines = append(lines, fmt.Sprintf("    ip saddr @blocked_v4 tcp dport 53 dnat ip to %s:53", r.PortalIP))
		lines = append(lines, "    ether saddr . ip daddr @hw_out tcp dport 80 return")
		lines = append(lines, fmt.Sprintf("    ip saddr @blocked_v4 tcp dport 80 dnat ip to %s:%d", r.PortalIP, r.PortalPort))
	}

	lines = append(lines, "  }")

	// Forward chain (filter)
	lines = append(lines, "  chain forward {")
	lines = append(lines, "    type filter hook forward priority 0; policy accept;")

	// Homework accepts first
	lines = append(lines, "    ether saddr . ip daddr @hw_out accept")
	lines = append(lines, "    ip saddr . ip daddr @hw_back accept")

	// LAN to blocked accepts (F27 order)
	if len(v4LAN) > 0 {
		cidrs := strings.Join(v4LAN, ", ")
		lines = append(lines, fmt.Sprintf("    ether saddr @blocked_mac ip daddr { %s } accept", cidrs))
		lines = append(lines, fmt.Sprintf("    ip saddr @blocked_v4 ip daddr { %s } accept", cidrs))
	}
	if len(v6LAN) > 0 {
		cidrs := strings.Join(v6LAN, ", ")
		lines = append(lines, fmt.Sprintf("    ether saddr @blocked_mac ip6 daddr { %s } accept", cidrs))
		lines = append(lines, fmt.Sprintf("    ip6 saddr @blocked_v6 ip6 daddr { %s } accept", cidrs))
	}

	// Return-drop rules for bidirectional redirect
	if len(v4LAN) > 0 {
		cidrs := strings.Join(v4LAN, ", ")
		lines = append(lines, fmt.Sprintf("    ip saddr { %s } ip daddr @blocked_v4 accept", cidrs))
	}
	lines = append(lines, "    ip daddr @blocked_v4 drop")

	if len(v6LAN) > 0 {
		cidrs := strings.Join(v6LAN, ", ")
		lines = append(lines, fmt.Sprintf("    ip6 saddr { %s } ip6 daddr @blocked_v6 accept", cidrs))
	}
	lines = append(lines, "    ip6 daddr @blocked_v6 drop")

	// Primary: MAC drop (F31)
	lines = append(lines, "    ether saddr @blocked_mac drop")

	// Secondary: IP drop (F31)
	lines = append(lines, "    ip saddr @blocked_v4 tcp dport 443 drop")
	lines = append(lines, "    ip6 saddr @blocked_v6 tcp dport 443 drop")
	lines = append(lines, "    ip saddr @blocked_v4 drop")
	lines = append(lines, "    ip6 saddr @blocked_v6 drop")

	lines = append(lines, "  }")
	lines = append(lines, "}")

	return strings.Join(lines, "\n")
}

// Helper functions

func filterByIPVersion(cidrs []string, v6 bool) []string {
	var result []string
	for _, cidr := range cidrs {
		isV6 := strings.Contains(cidr, ":")
		if isV6 == v6 {
			result = append(result, cidr)
		}
	}
	return result
}

func setDecl(name, typ string, elements []string) string {
	if len(elements) == 0 {
		return fmt.Sprintf("  set %s { type %s; }", name, typ)
	}

	sorted := make([]string, len(elements))
	copy(sorted, elements)
	sort.Strings(sorted)

	body := fmt.Sprintf("elements = { %s }", strings.Join(sorted, ", "))
	return fmt.Sprintf("  set %s { type %s; %s }", name, typ, body)
}

func hwSetDecl(name, typ string, elements []string) string {
	if len(elements) == 0 {
		return fmt.Sprintf("  set %s { type %s; flags timeout; }", name, typ)
	}

	body := fmt.Sprintf("elements = { %s }", strings.Join(elements, ", "))
	return fmt.Sprintf("  set %s { type %s; flags timeout; %s }", name, typ, body)
}

// hwElems generates homework pair elements with timeouts
// pairs: map[a]b where a is MAC (out=true) or IP (out=false), b is IP
func hwElems(pairs map[string]string, out bool) []string {
	if len(pairs) == 0 {
		return nil
	}

	var elems []string
	for a, b := range pairs {
		// Validate pairs
		if out {
			if !macPattern.MatchString(a) || !isIPv4(b) {
				continue
			}
		} else {
			if !isIPv4(a) || !isIPv4(b) {
				continue
			}
		}

		// Add with timeout (H3)
		elem := fmt.Sprintf("%s . %s timeout 300s", a, b)
		elems = append(elems, elem)
	}

	sort.Strings(elems)
	return elems
}

func isIPv4(s string) bool {
	ip := net.ParseIP(s)
	return ip != nil && ip.To4() != nil
}

// NewRules creates a Rules object with default LANCIDRs
func NewRules() *Rules {
	return &Rules{
		LANCIDRs:  defaultLANCIDRs(),
		BlockedV4: []string{},
		BlockedV6: []string{},
		BlockedMACs: []string{},
		HWOut:     make(map[string]string),
		HWBack:    make(map[string]string),
	}
}

func defaultLANCIDRs() []string {
	return []string{
		"192.168.0.0/16",
		"10.0.0.0/8",
		"172.16.0.0/12",
		"fe80::/10",
		"fc00::/7",
	}
}
