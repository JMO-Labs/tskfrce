package vlan

import (
	"log/slog"
	"net"
	"sort"
	"sync"

	"github.com/gopacket/gopacket"
	"github.com/gopacket/gopacket/layers"
	"github.com/mdlayher/packet"
)

const (
	maxVLANs       = 4094       // Valid VLAN IDs 1-4094 per spec
	maxMACsPerVLAN = 1000       // Cap per VLAN to prevent DoS memory growth
	maxTotalMACs   = 10000      // Cap total MACs across all VLANs
)

// Detector listens for 802.1Q frames and detects VLAN topology (F49)
type Detector struct {
	mu          sync.RWMutex
	lanIface    *net.Interface
	mirrorIface *net.Interface
	vlans       map[uint16]*vlanInfo // VID -> vlanInfo
	macVLANs    map[string]map[uint16]bool // MAC -> VIDs
	logger      *slog.Logger
	stopChan    chan struct{}
}

type vlanInfo struct {
	macs    map[string]bool // Distinct MACs on this VLAN
	subnets map[string]int  // /24 subnet -> count (voting)
}

// New creates a new VLAN detector
func New(lanIfaceName, mirrorIfaceName string, logger *slog.Logger) (*Detector, error) {
	d := &Detector{
		vlans:    make(map[uint16]*vlanInfo),
		macVLANs: make(map[string]map[uint16]bool),
		logger:   logger,
		stopChan: make(chan struct{}),
	}

	if lanIfaceName != "" {
		iface, err := net.InterfaceByName(lanIfaceName)
		if err == nil {
			d.lanIface = iface
		}
	}

	if mirrorIfaceName != "" {
		iface, err := net.InterfaceByName(mirrorIfaceName)
		if err == nil {
			d.mirrorIface = iface
		}
	}

	return d, nil
}

// Start begins listening for 802.1Q frames (F49)
func (d *Detector) Start() error {
	if d.lanIface == nil && d.mirrorIface == nil {
		return ErrNoInterface
	}

	// Listen on LAN interface if set
	if d.lanIface != nil {
		go d.listenOnInterface(d.lanIface)
	}

	// Listen on mirror interface if set
	if d.mirrorIface != nil {
		go d.listenOnInterface(d.mirrorIface)
	}

	return nil
}

// listenOnInterface listens for 802.1Q frames on a specific interface
func (d *Detector) listenOnInterface(iface *net.Interface) {
	defer func() {
		if r := recover(); r != nil {
			d.logger.Error("vlan listener panic", "iface", iface.Name, "err", r)
		}
	}()

	conn, err := packet.Listen(iface, packet.Raw, 0, nil)
	if err != nil {
		d.logger.Error("failed to listen on interface", "iface", iface.Name, "err", err)
		return
	}
	defer conn.Close()

	buf := make([]byte, 4096)

	for {
		select {
		case <-d.stopChan:
			return
		default:
		}

		n, _, err := conn.ReadFrom(buf)
		if err != nil {
			d.logger.Error("read error on interface", "iface", iface.Name, "err", err)
			return
		}

		// Parse Ethernet layer
		var eth layers.Ethernet
		if err := eth.DecodeFromBytes(buf[:n], gopacket.NilDecodeFeedback); err != nil {
			continue
		}

		// Check if it's a VLAN frame
		if eth.EthernetType != layers.EthernetTypeDot1Q {
			continue
		}

		// Parse 802.1Q tag
		var dot1q layers.Dot1Q
		if err := dot1q.DecodeFromBytes(eth.Payload, gopacket.NilDecodeFeedback); err != nil {
			continue
		}

		vid := dot1q.VLANIdentifier
		if vid == 0 || vid > 4094 {
			continue
		}

		// Record MAC on this VLAN
		d.recordMACOnVLAN(eth.SrcMAC.String(), vid)

		// Process ARP if present
		if dot1q.Type == layers.EthernetTypeARP {
			var arp layers.ARP
			if err := arp.DecodeFromBytes(dot1q.Payload, gopacket.NilDecodeFeedback); err != nil {
				continue
			}

			// F49, F55: ARP sender IP counts only if hwsrc == ether src, private v4, not unspecified/link-local
			if d.isValidARPSender(eth.SrcMAC, arp.SourceHwAddress, arp.SourceProtAddress) {
				senderIP := net.IP(arp.SourceProtAddress)
				d.recordSubnetVote(vid, senderIP)
			}
		}
	}
}

// recordMACOnVLAN records a MAC address seen on a VLAN (F49: cap to prevent DoS)
func (d *Detector) recordMACOnVLAN(mac string, vid uint16) {
	d.mu.Lock()
	defer d.mu.Unlock()

	vi, vlanExists := d.vlans[vid]

	// Cap: max VLANs (reject new VLANs once at limit)
	if len(d.vlans) >= maxVLANs && !vlanExists {
		return
	}

	// Ensure VLAN info exists
	if !vlanExists {
		vi = &vlanInfo{
			macs:    make(map[string]bool),
			subnets: make(map[string]int),
		}
		d.vlans[vid] = vi
	}

	// Cap: max MACs per VLAN (ignore new MACs once limit reached)
	if len(vi.macs) >= maxMACsPerVLAN && !vi.macs[mac] {
		return
	}

	// Cap: max total MACs across all VLANs (ignore new MACs once limit reached)
	if !vi.macs[mac] {
		totalMACs := 0
		for _, info := range d.vlans {
			totalMACs += len(info.macs)
		}
		if totalMACs >= maxTotalMACs {
			return
		}
	}

	// Record MAC
	vi.macs[mac] = true

	// Track MAC -> VLAN mapping
	if _, exists := d.macVLANs[mac]; !exists {
		d.macVLANs[mac] = make(map[uint16]bool)
	}
	d.macVLANs[mac][vid] = true
}

// recordSubnetVote records a /24 subnet vote for a VLAN
func (d *Detector) recordSubnetVote(vid uint16, ip net.IP) {
	d.mu.Lock()
	defer d.mu.Unlock()

	if _, exists := d.vlans[vid]; !exists {
		d.vlans[vid] = &vlanInfo{
			macs:    make(map[string]bool),
			subnets: make(map[string]int),
		}
	}

	// Extract /24 subnet
	if ip4 := ip.To4(); ip4 != nil {
		subnet := net.IPv4(ip4[0], ip4[1], ip4[2], 0).String() + "/24"
		d.vlans[vid].subnets[subnet]++
	}
}

// isValidARPSender checks if an ARP sender is valid (F55)
func (d *Detector) isValidARPSender(ethSrc net.HardwareAddr, hwSrc net.HardwareAddr, protAddr []byte) bool {
	// F55: hwsrc == ether src
	if len(ethSrc) != len(hwSrc) || string(ethSrc) != string(hwSrc) {
		return false
	}

	ip := net.IP(protAddr)
	if ip4 := ip.To4(); ip4 != nil {
		// F55: private v4, not unspecified/link-local
		if !ip4.IsPrivate() {
			return false
		}
		if ip4.IsUnspecified() || ip4.IsLinkLocalUnicast() {
			return false
		}
		return true
	}

	return false
}

// GetVLANs returns detected VLANs with subnet information
func (d *Detector) GetVLANs() map[uint16]*VLANInfo {
	d.mu.RLock()
	defer d.mu.RUnlock()

	result := make(map[uint16]*VLANInfo)
	for vid, info := range d.vlans {
		macs := make([]string, 0, len(info.macs))
		for mac := range info.macs {
			macs = append(macs, mac)
		}
		sort.Strings(macs)

		// Determine best subnet by vote count
		var bestSubnet *net.IPNet
		if len(info.subnets) > 0 {
			maxVotes := 0
			for subnet, count := range info.subnets {
				if count > maxVotes {
					maxVotes = count
					_, bestSubnet, _ = net.ParseCIDR(subnet)
				}
			}
		}

		result[vid] = &VLANInfo{
			VID:     vid,
			MACs:    macs,
			Subnet:  bestSubnet,
		}
	}

	return result
}

// VLANInfo holds detected VLAN information
type VLANInfo struct {
	VID    uint16
	MACs   []string
	Subnet *net.IPNet
}

// Stop halts VLAN detection
func (d *Detector) Stop() {
	close(d.stopChan)
}

// Errors
var (
	ErrNoInterface = errType("no interface configured for VLAN detection")
)

type errType string

func (e errType) Error() string { return string(e) }
