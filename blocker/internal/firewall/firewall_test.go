package firewall

import (
	"strings"
	"testing"
)

func TestRenderBlocksV4AndV6ToWANAllowsLAN(t *testing.T) {
	r := &Rules{
		BlockedV4:   []string{"192.168.1.50"},
		BlockedV6:   []string{"fe80::50"},
		BlockedMACs: []string{"de:ad:be:ef:00:01"},
		LANCIDRs:    []string{"192.168.1.0/24", "fe80::/10"},
		PortalIP:    "192.168.1.2",
		PortalPort:  8080,
	}

	ruleset := r.Render()

	if !strings.Contains(ruleset, "192.168.1.50") {
		t.Errorf("expected v4 address in ruleset")
	}
	if !strings.Contains(ruleset, "fe80::50") {
		t.Errorf("expected v6 address in ruleset")
	}
	if !strings.Contains(ruleset, "ip saddr @blocked_v4 ip daddr { 192.168.1.0/24 } accept") {
		t.Errorf("expected v4 LAN accept rule")
	}
	if !strings.Contains(ruleset, "ip6 saddr @blocked_v6 ip6 daddr { fe80::/10 } accept") {
		t.Errorf("expected v6 LAN accept rule")
	}
	if !strings.Contains(ruleset, "ip saddr @blocked_v4 drop") {
		t.Errorf("expected v4 drop rule")
	}
	if !strings.Contains(ruleset, "ip6 saddr @blocked_v6 drop") {
		t.Errorf("expected v6 drop rule")
	}
}

func TestRenderDropsReturnTrafficToBlockedIPs(t *testing.T) {
	r := &Rules{
		BlockedV4:   []string{"192.168.1.50"},
		BlockedV6:   []string{"fe80::50"},
		BlockedMACs: []string{"de:ad:be:ef:00:01"},
		LANCIDRs:    []string{"192.168.1.0/24", "fe80::/10"},
		PortalIP:    "192.168.1.2",
		PortalPort:  8080,
	}

	ruleset := r.Render()

	if !strings.Contains(ruleset, "ip daddr @blocked_v4 drop") {
		t.Errorf("expected v4 return traffic drop")
	}
	if !strings.Contains(ruleset, "ip6 daddr @blocked_v6 drop") {
		t.Errorf("expected v6 return traffic drop")
	}
}

func TestRenderKeepsLANToBlockedReachableInOrder(t *testing.T) {
	r := &Rules{
		BlockedV4:   []string{"192.168.1.50"},
		BlockedV6:   []string{"fe80::50"},
		BlockedMACs: []string{"de:ad:be:ef:00:01"},
		LANCIDRs:    []string{"192.168.1.0/24", "fe80::/10"},
		PortalIP:    "192.168.1.2",
		PortalPort:  8080,
	}

	ruleset := r.Render()
	lines := strings.Split(ruleset, "\n")

	var v4LanIdx, v6LanIdx, v4InIdx, v6InIdx, v4DropIdx, v6DropIdx, sAddrDropIdx int

	for i, line := range lines {
		line = strings.TrimSpace(line)
		if line == "ip saddr @blocked_v4 ip daddr { 192.168.1.0/24 } accept" {
			v4LanIdx = i
		}
		if line == "ip6 saddr @blocked_v6 ip6 daddr { fe80::/10 } accept" {
			v6LanIdx = i
		}
		if strings.Contains(line, "ip saddr { 192.168.1.0/24 } ip daddr @blocked_v4 accept") {
			v4InIdx = i
		}
		if strings.Contains(line, "ip6 saddr { fe80::/10 } ip6 daddr @blocked_v6 accept") {
			v6InIdx = i
		}
		if line == "ip daddr @blocked_v4 drop" {
			v4DropIdx = i
		}
		if line == "ip6 daddr @blocked_v6 drop" {
			v6DropIdx = i
		}
		if line == "ether saddr @blocked_mac drop" {
			sAddrDropIdx = i
		}
	}

	if v4LanIdx >= v4InIdx || v4InIdx >= v4DropIdx || v4DropIdx >= sAddrDropIdx {
		t.Errorf("v4 rules out of order: v4LAN(%d) < v4In(%d) < v4Drop(%d) < sAddrDrop(%d)",
			v4LanIdx, v4InIdx, v4DropIdx, sAddrDropIdx)
	}
	if v6LanIdx >= v6InIdx || v6InIdx >= v6DropIdx || v6DropIdx >= sAddrDropIdx {
		t.Errorf("v6 rules out of order: v6LAN(%d) < v6In(%d) < v6Drop(%d) < sAddrDrop(%d)",
			v6LanIdx, v6InIdx, v6DropIdx, sAddrDropIdx)
	}
}

func TestRenderOmitsLANToBlockedAcceptWithoutLANFamily(t *testing.T) {
	r := &Rules{
		BlockedV4:   []string{"192.168.1.50"},
		BlockedV6:   []string{},
		BlockedMACs: []string{"de:ad:be:ef:00:01"},
		LANCIDRs:    []string{"192.168.1.0/24"},
		PortalIP:    "192.168.1.2",
		PortalPort:  80,
	}

	ruleset := r.Render()

	if strings.Contains(ruleset, "ip6 saddr {") {
		t.Errorf("expected no v6 rules without v6 LAN CIDR")
	}
	if !strings.Contains(ruleset, "ip saddr { 192.168.1.0/24 } ip daddr @blocked_v4 accept") {
		t.Errorf("expected v4 rule to be present")
	}
}

func TestRenderDropsByMACAuthoritative(t *testing.T) {
	r := &Rules{
		BlockedV4:   []string{},
		BlockedV6:   []string{},
		BlockedMACs: []string{"de:ad:be:ef:00:01"},
		LANCIDRs:    []string{"192.168.1.0/24", "fe80::/10"},
		PortalIP:    "192.168.1.2",
		PortalPort:  8080,
	}

	ruleset := r.Render()

	if !strings.Contains(ruleset, "de:ad:be:ef:00:01") {
		t.Errorf("expected MAC in ruleset")
	}
	if !strings.Contains(ruleset, "ether saddr @blocked_mac drop") {
		t.Errorf("expected MAC drop rule")
	}
}

func TestRenderRedirectsDNSAndHTTPDropsHTTPS(t *testing.T) {
	r := &Rules{
		BlockedV4:   []string{"192.168.1.50"},
		BlockedV6:   []string{},
		BlockedMACs: []string{"de:ad:be:ef:00:01"},
		LANCIDRs:    []string{"192.168.1.0/24"},
		PortalIP:    "192.168.1.2",
		PortalPort:  8080,
	}

	ruleset := r.Render()

	if !strings.Contains(ruleset, "udp dport 53 dnat ip to 192.168.1.2:53") {
		t.Errorf("expected UDP DNS redirect")
	}
	if !strings.Contains(ruleset, "tcp dport 80 dnat ip to 192.168.1.2:8080") {
		t.Errorf("expected TCP HTTP redirect")
	}
	if !strings.Contains(ruleset, "tcp dport 443 drop") {
		t.Errorf("expected HTTPS drop")
	}
}

func TestRenderOmitsDNATWhenNoPortalIP(t *testing.T) {
	r := &Rules{
		BlockedV4:   []string{"192.168.1.50"},
		BlockedV6:   []string{},
		BlockedMACs: []string{"de:ad:be:ef:00:01"},
		LANCIDRs:    []string{"192.168.1.0/24"},
		PortalIP:    "",
		PortalPort:  80,
	}

	ruleset := r.Render()

	if strings.Contains(ruleset, "dnat") {
		t.Errorf("expected no DNAT rules without portal IP")
	}
	if !strings.Contains(ruleset, "ip saddr @blocked_v4 drop") {
		t.Errorf("expected drop rules to still apply")
	}
	if !strings.Contains(ruleset, "ether saddr @blocked_mac drop") {
		t.Errorf("expected MAC drop to still apply")
	}
}

func TestRenderEmptySetIsNoopSafe(t *testing.T) {
	r := &Rules{
		BlockedV4:   []string{},
		BlockedV6:   []string{},
		BlockedMACs: []string{},
		LANCIDRs:    []string{"192.168.1.0/24", "fe80::/10"},
		PortalIP:    "192.168.1.2",
		PortalPort:  8080,
	}

	ruleset := r.Render()

	if strings.Contains(ruleset, "elements") {
		t.Errorf("expected no 'elements' when sets are empty")
	}
	if !strings.HasPrefix(ruleset, "add table inet "+TABLE) {
		t.Errorf("expected table add at start")
	}
	if !strings.HasSuffix(strings.TrimSpace(ruleset), "}") {
		t.Errorf("expected closing brace at end")
	}
}

func TestRenderDNSToPort53HTTPToPortalPort(t *testing.T) {
	r := &Rules{
		BlockedV4:   []string{"192.168.1.50"},
		BlockedV6:   []string{},
		BlockedMACs: []string{"de:ad:be:ef:00:01"},
		LANCIDRs:    []string{"192.168.1.0/24"},
		PortalIP:    "192.168.1.2",
		PortalPort:  8080,
	}

	ruleset := r.Render()

	dnsLines := strings.Split(ruleset, "\n")
	var dnsCnt, httpCnt int

	for _, line := range dnsLines {
		if strings.Contains(line, "dport 53 dnat") {
			dnsCnt++
			if !strings.HasSuffix(line, ":53") {
				t.Errorf("expected DNS dnat to port 53")
			}
		}
		if strings.Contains(line, "dport 80 dnat") && !strings.Contains(line, "return") {
			httpCnt++
			if !strings.HasSuffix(line, ":8080") {
				t.Errorf("expected HTTP dnat to portal port")
			}
		}
	}

	if dnsCnt != 2 {
		t.Errorf("expected 2 DNS rules (UDP and TCP), got %d", dnsCnt)
	}
	if httpCnt != 1 {
		t.Errorf("expected 1 HTTP rule, got %d", httpCnt)
	}
}

func TestLockedDeviceReachesBoxServices(t *testing.T) {
	// Use default LAN CIDRs
	r := &Rules{
		BlockedV4:   []string{},
		BlockedV6:   []string{},
		BlockedMACs: []string{"de:ad:be:ef:00:01"},
		LANCIDRs:    defaultLANCIDRs(),
		PortalIP:    "192.168.1.2",
		PortalPort:  80,
	}

	ruleset := r.Render()
	lines := strings.Split(ruleset, "\n")

	var acceptIdx, dropIdx int
	for i, line := range lines {
		line = strings.TrimSpace(line)
		if strings.Contains(line, "ether saddr @blocked_mac") &&
		   strings.Contains(line, "172.16.0.0/12") &&
		   strings.Contains(line, "accept") {
			acceptIdx = i
		}
		if line == "ether saddr @blocked_mac drop" {
			dropIdx = i
		}
	}

	if acceptIdx == 0 || dropIdx == 0 || acceptIdx >= dropIdx {
		t.Errorf("expected accept rule before drop rule for box services")
	}
}

func TestRenderHomeworkPairs(t *testing.T) {
	r := &Rules{
		BlockedV4:   []string{},
		BlockedV6:   []string{},
		BlockedMACs: []string{},
		LANCIDRs:    []string{"192.168.1.0/24", "fe80::/10"},
		PortalIP:    "192.168.1.2",
		PortalPort:  8080,
		HWOut:       map[string]string{"aa:bb:cc:dd:ee:01": "8.8.8.8", "aa:bb:cc:dd:ee:02": "1.1.1.1"},
		HWBack:      map[string]string{"8.8.8.8": "192.168.1.10", "1.1.1.1": "192.168.1.11"},
	}

	ruleset := r.Render()

	if !strings.Contains(ruleset, "set hw_out { type ether_addr . ipv4_addr") {
		t.Errorf("expected hw_out set declaration")
	}
	if !strings.Contains(ruleset, "set hw_back { type ipv4_addr . ipv4_addr") {
		t.Errorf("expected hw_back set declaration")
	}
	if !strings.Contains(ruleset, "aa:bb:cc:dd:ee:01 . 8.8.8.8") {
		t.Errorf("expected hw_out element")
	}
	if !strings.Contains(ruleset, "8.8.8.8 . 192.168.1.10") {
		t.Errorf("expected hw_back element")
	}
	if !strings.Contains(ruleset, "ether saddr . ip daddr @hw_out accept") {
		t.Errorf("expected hw_out accept rule")
	}
	if !strings.Contains(ruleset, "ip saddr . ip daddr @hw_back accept") {
		t.Errorf("expected hw_back accept rule")
	}
}

func TestRenderHomeworkPairsAcceptBeforeDrops(t *testing.T) {
	r := &Rules{
		BlockedV4:   []string{"192.168.1.50"},
		BlockedV6:   []string{},
		BlockedMACs: []string{"de:ad:be:ef:00:01"},
		LANCIDRs:    []string{"192.168.1.0/24", "fe80::/10"},
		PortalIP:    "192.168.1.2",
		PortalPort:  8080,
		HWOut:       map[string]string{"aa:bb:cc:dd:ee:01": "8.8.8.8"},
		HWBack:      map[string]string{"8.8.8.8": "192.168.1.10"},
	}

	ruleset := r.Render()
	lines := strings.Split(ruleset, "\n")

	var hwOutIdx, hwBackIdx, macDropIdx int

	for i, line := range lines {
		line = strings.TrimSpace(line)
		if line == "ether saddr . ip daddr @hw_out accept" {
			hwOutIdx = i
		}
		if line == "ip saddr . ip daddr @hw_back accept" {
			hwBackIdx = i
		}
		if line == "ether saddr @blocked_mac drop" {
			macDropIdx = i
		}
	}

	if hwOutIdx >= macDropIdx || hwBackIdx >= macDropIdx {
		t.Errorf("homework accepts must come before drops")
	}
}

func TestRenderEmptyHomeworkPairs(t *testing.T) {
	r := &Rules{
		BlockedV4:   []string{},
		BlockedV6:   []string{},
		BlockedMACs: []string{},
		LANCIDRs:    []string{"192.168.1.0/24", "fe80::/10"},
		PortalIP:    "192.168.1.2",
		PortalPort:  8080,
		HWOut:       map[string]string{},
		HWBack:      map[string]string{},
	}

	ruleset := r.Render()

	if !strings.Contains(ruleset, "set hw_out { type ether_addr . ipv4_addr; flags timeout;") {
		t.Errorf("expected empty hw_out set")
	}
	if !strings.Contains(ruleset, "set hw_back { type ipv4_addr . ipv4_addr; flags timeout;") {
		t.Errorf("expected empty hw_back set")
	}
	// Rules should still be present even with empty sets
	if !strings.Contains(ruleset, "ether saddr . ip daddr @hw_out accept") {
		t.Errorf("expected hw_out accept rule")
	}
	if !strings.Contains(ruleset, "ip saddr . ip daddr @hw_back accept") {
		t.Errorf("expected hw_back accept rule")
	}
}

func TestRenderHomeworkSetsHaveTimeouts(t *testing.T) {
	r := &Rules{
		BlockedV4:   []string{},
		BlockedV6:   []string{},
		BlockedMACs: []string{},
		LANCIDRs:    []string{"192.168.1.0/24", "fe80::/10"},
		PortalIP:    "192.168.1.2",
		PortalPort:  8080,
		HWOut:       map[string]string{"aa:bb:cc:dd:ee:01": "8.8.8.8"},
		HWBack:      map[string]string{"8.8.8.8": "192.168.1.10"},
	}

	ruleset := r.Render()

	// Should have flags timeout
	if !strings.Contains(ruleset, "flags timeout;") {
		t.Errorf("expected homework sets to have flags timeout")
	}

	// Elements should have timeout suffix
	if !strings.Contains(ruleset, "timeout 300s") {
		t.Errorf("expected elements to have timeout")
	}
}

func TestValidateMAC(t *testing.T) {
	tests := []struct {
		mac   string
		valid bool
	}{
		{"aa:bb:cc:dd:ee:ff", true},
		{"AA:BB:CC:DD:EE:FF", false}, // uppercase not allowed
		{"aa:bb:cc:dd:ee", false},     // too short
		{"aa:bb:cc:dd:ee:ff:00", false}, // too long
		{"gg:bb:cc:dd:ee:ff", false},  // invalid hex
	}

	for _, tt := range tests {
		valid := macPattern.MatchString(tt.mac)
		if valid != tt.valid {
			t.Errorf("MAC %s: expected valid=%v, got %v", tt.mac, tt.valid, valid)
		}
	}
}

func TestIsIPv4(t *testing.T) {
	tests := []struct {
		ip    string
		valid bool
	}{
		{"192.168.1.1", true},
		{"8.8.8.8", true},
		{"256.1.1.1", false},
		{"fe80::1", false},
		{"not-an-ip", false},
	}

	for _, tt := range tests {
		valid := isIPv4(tt.ip)
		if valid != tt.valid {
			t.Errorf("IP %s: expected valid=%v, got %v", tt.ip, tt.valid, valid)
		}
	}
}

func TestFilterByIPVersion(t *testing.T) {
	cidrs := []string{"192.168.1.0/24", "10.0.0.0/8", "fe80::/10", "fc00::/7"}

	v4 := filterByIPVersion(cidrs, false)
	if len(v4) != 2 || !contains(v4, "192.168.1.0/24") {
		t.Errorf("expected v4 filtering, got %v", v4)
	}

	v6 := filterByIPVersion(cidrs, true)
	if len(v6) != 2 || !contains(v6, "fe80::/10") {
		t.Errorf("expected v6 filtering, got %v", v6)
	}
}

func contains(slice []string, s string) bool {
	for _, v := range slice {
		if v == s {
			return true
		}
	}
	return false
}
