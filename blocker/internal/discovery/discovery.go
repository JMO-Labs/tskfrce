package discovery

import (
	"fmt"
	"strings"

	"github.com/jmo-labs/tskfrce/blocker/internal/backend"
)

const (
	maxIPv6 = 8
	maxStr  = 255
)

// OnSeen is called when a device is discovered
type OnSeen func(*backend.Seen)

// Scanner performs ARP/NDP discovery
type Scanner struct {
	iface string
}

// NewScanner creates a discovery scanner for the given interface
func NewScanner(iface string) *Scanner {
	return &Scanner{iface: iface}
}

// ScanOnce performs one ARP sweep and NDP query
func (s *Scanner) ScanOnce(onSeen OnSeen) error {
	v4, err := s.scanARP()
	if err != nil {
		return fmt.Errorf("arp scan failed: %w", err)
	}

	v6 := make(map[string][]string)
	if err := s.scanNDP(v6); err != nil {
		// NDP failure is logged but not fatal (F36)
		fmt.Printf("ndp scan warning: %v\n", err)
	}

	// Deduplicate IPv6 to max 8 per MAC
	for mac, addrs := range v6 {
		if len(addrs) > maxIPv6 {
			v6[mac] = addrs[:maxIPv6]
		}
	}

	// Report ARP responders only (F37)
	for mac, ip := range v4 {
		vendor := vendorFor(mac)
		hostname := reverseDNS(ip)

		seen := &backend.Seen{
			MAC:      strings.ToLower(mac),
			IP:       &ip,
			IPv6:     v6[strings.ToLower(mac)],
			Hostname: hostname,
			Vendor:   vendor,
		}

		if hostname != nil && len(*hostname) > maxStr {
			h := (*hostname)[:maxStr]
			seen.Hostname = &h
		}

		if vendor != nil && len(*vendor) > maxStr {
			v := (*vendor)[:maxStr]
			seen.Vendor = &v
		}

		if onSeen != nil {
			onSeen(seen)
		}
	}

	return nil
}

func (s *Scanner) scanARP() (map[string]string, error) {
	// TODO: Implement ARP sweep of /24 from interface (2s timeout)
	// For now, return empty results
	return make(map[string]string), nil
}

func (s *Scanner) scanNDP(results map[string][]string) error {
	// TODO: Implement NDP echo to ff02::1 (2s, multi-answer)
	// For now, return nil
	return nil
}

func vendorFor(mac string) *string {
	// TODO: Implement OUI lookup (F38)
	return nil
}

func reverseDNS(ip string) *string {
	// TODO: Implement reverse DNS with timeout
	return nil
}
