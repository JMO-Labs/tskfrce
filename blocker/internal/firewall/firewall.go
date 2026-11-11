package firewall

import (
	"context"
	"net"
)

// Firewall manages nftables rules
type Firewall struct {
	// TODO: netlink connection field
}

// New creates a new firewall manager
func New() *Firewall {
	return &Firewall{}
}

// Apply loads the firewall ruleset atomically
func (f *Firewall) Apply(ctx context.Context, rules *Rules) error {
	// TODO: Implement F27 atomic table load via netlink
	return nil
}

// Delete removes the nftables table
func (f *Firewall) Delete(ctx context.Context) error {
	// TODO: Implement F58 table deletion for fail-open
	return nil
}

// Rules describes a complete firewall ruleset
type Rules struct {
	BlockedV4    []net.IP  // v4 addresses to drop
	BlockedV6    []net.IP  // v6 addresses to drop
	BlockedMACs  []string  // MACs to drop
	PortalIP     net.IP    // Portal redirect IP
	PortalPort   uint16    // Portal redirect port
	LANCIDRs     []*net.IPNet // LAN CIDR ranges for exception
}

// Render produces the nft ruleset text for debugging/testing
func (r *Rules) Render() string {
	// TODO: Implement F27 ruleset rendering
	return ""
}
