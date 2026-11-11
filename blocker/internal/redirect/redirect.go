package redirect

import (
	"context"
	"log/slog"
	"net"
	"sync"
	"time"

	"github.com/gopacket/gopacket"
	"github.com/gopacket/gopacket/layers"
	"github.com/mdlayher/packet"
	"github.com/vishvananda/netlink"
)

// Manager handles ARP/NDP spoofing and healing (F23-F26)
type Manager struct {
	mu              sync.Mutex
	lanIface        *net.Interface
	targets         map[string]*targetLoop // MAC -> active goroutine
	portalIP        net.IP
	gatewayIPv4     net.IP
	gatewayIPv6     net.IP
	gatewayMacIPv4  net.HardwareAddr
	gatewayMacIPv6  net.HardwareAddr
	lastGatewaySync time.Time
	logger          *slog.Logger
}

type targetLoop struct {
	mac     string
	ips     []net.IP
	ctx     context.Context
	cancel  context.CancelFunc
	done    chan struct{}
}

// New creates a new redirect manager (F26: read portal IP once at startup)
func New(lanIfaceName string, logger *slog.Logger) (*Manager, error) {
	m := &Manager{
		targets:  make(map[string]*targetLoop),
		logger:   logger,
	}

	// F26: Portal/box IP = IPv4 of LAN_IFACE or eth0, read once at startup
	var lanIface *net.Interface
	var err error
	if lanIfaceName != "" {
		lanIface, err = net.InterfaceByName(lanIfaceName)
	} else {
		lanIface, err = net.InterfaceByName("eth0")
	}
	if err != nil {
		return nil, err
	}
	m.lanIface = lanIface

	// Get IPv4 address for portal
	addrs, err := lanIface.Addrs()
	if err != nil {
		return nil, err
	}
	for _, addr := range addrs {
		if ipnet, ok := addr.(*net.IPNet); ok && ipnet.IP.To4() != nil {
			m.portalIP = ipnet.IP.To4()
			break
		}
	}
	if m.portalIP == nil {
		return nil, ErrNoPortalIP
	}

	// Start gateway sync loop (F25: detect every 30s)
	go m.gatewayLoop()

	return m, nil
}

// UpdateTargets applies active targeting set and starts/stops goroutines
func (m *Manager) UpdateTargets(activeTargets map[string][]net.IP) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Stop targets no longer active
	for mac, loop := range m.targets {
		if _, still := activeTargets[mac]; !still {
			m.startHeal(loop)
			loop.cancel()
			delete(m.targets, mac)
		}
	}

	// Start new targets
	for mac, ips := range activeTargets {
		if _, running := m.targets[mac]; !running {
			ctx, cancel := context.WithCancel(context.Background())
			tl := &targetLoop{
				mac:    mac,
				ips:    ips,
				ctx:    ctx,
				cancel: cancel,
				done:   make(chan struct{}),
			}
			m.targets[mac] = tl
			go m.spoofLoop(tl)
		}
	}
}

// spoofLoop sends ARP/NDP spoof frames every 2s (F23)
func (m *Manager) spoofLoop(tl *targetLoop) {
	defer func() {
		if r := recover(); r != nil {
			m.logger.Error("spoof loop panic", "mac", tl.mac, "err", r)
		}
		close(tl.done)
	}()

	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-tl.ctx.Done():
			return
		case <-ticker.C:
			m.sendSpoofs(tl.mac, tl.ips)
		}
	}
}

// sendSpoofs sends one round of ARP/NDP spoofs (F23)
func (m *Manager) sendSpoofs(mac string, ips []net.IP) {
	m.mu.Lock()
	gatewayIPv4, gatewayIPv6 := m.gatewayIPv4, m.gatewayIPv6
	gatewayMacIPv4, gatewayMacIPv6 := m.gatewayMacIPv4, m.gatewayMacIPv6
	m.mu.Unlock()

	conn, err := packet.Listen(m.lanIface, packet.Raw, 0, nil)
	if err != nil {
		m.logger.Error("failed to open packet conn", "err", err)
		return
	}
	defer conn.Close()

	// Parse target MAC
	targetMac, err := net.ParseMAC(mac)
	if err != nil {
		m.logger.Error("invalid target MAC", "mac", mac)
		return
	}

	for _, ip := range ips {
		if ip.To4() != nil && gatewayIPv4 != nil {
			// F23: ARP reply to device "gateway IP is at box MAC"
			m.sendARPReply(conn, gatewayIPv4, targetMac)
			// F23: ARP reply to gateway "device IP is at box MAC"
			if len(gatewayMacIPv4) > 0 {
				m.sendARPReply(conn, ip, gatewayMacIPv4)
			}
		} else if ip.To4() == nil && gatewayIPv6 != nil {
			// F23: NDP NA (R=1,S=0,O=1,target-LL) + reverse NA
			m.sendNDPNA(conn, ip, targetMac)
			if len(gatewayMacIPv6) > 0 {
				m.sendNDPNA(conn, gatewayIPv6, gatewayMacIPv6)
			}
		}
	}
}

// sendARPReply sends an ARP reply frame
func (m *Manager) sendARPReply(conn *packet.Conn, targetIP net.IP, targetMac net.HardwareAddr) {
	eth := layers.Ethernet{
		SrcMAC:       m.lanIface.HardwareAddr,
		DstMAC:       targetMac,
		EthernetType: layers.EthernetTypeARP,
	}
	arp := layers.ARP{
		AddrType:          layers.LinkTypeEthernet,
		Protocol:          layers.EthernetTypeIPv4,
		HwAddressSize:     6,
		ProtAddressSize:   4,
		Operation:         layers.ARPReply,
		SourceHwAddress:   []byte(m.lanIface.HardwareAddr),
		SourceProtAddress: []byte(m.portalIP.To4()),
		DstHwAddress:      []byte(targetMac),
		DstProtAddress:    []byte(targetIP.To4()),
	}

	buf := gopacket.NewSerializeBuffer()
	if err := gopacket.SerializeLayers(buf, gopacket.SerializeOptions{}, &eth, &arp); err != nil {
		m.logger.Error("failed to serialize ARP", "err", err)
		return
	}
	if _, err := conn.WriteTo(buf.Bytes(), nil); err != nil {
		m.logger.Error("failed to send ARP", "err", err)
	}
}

// sendNDPNA sends an NDP Neighbor Advertisement
func (m *Manager) sendNDPNA(conn *packet.Conn, targetIP net.IP, targetMac net.HardwareAddr) {
	eth := layers.Ethernet{
		SrcMAC:       m.lanIface.HardwareAddr,
		DstMAC:       targetMac,
		EthernetType: layers.EthernetTypeIPv6,
	}
	ipv6 := layers.IPv6{
		Version:      6,
		TrafficClass: 0,
		FlowLabel:    0,
		Length:       32,
		NextHeader:   layers.IPProtocolICMPv6,
		HopLimit:     255,
		SrcIP:        targetIP,
		DstIP:        targetIP,
	}
	ndp := layers.ICMPv6NeighborAdvertisement{
		Flags:          0x60, // R=1, S=0, O=1
		TargetAddress:  targetIP,
	}

	buf := gopacket.NewSerializeBuffer()
	if err := gopacket.SerializeLayers(buf, gopacket.SerializeOptions{}, &eth, &ipv6, &ndp); err != nil {
		m.logger.Error("failed to serialize NDP NA", "err", err)
		return
	}
	if _, err := conn.WriteTo(buf.Bytes(), nil); err != nil {
		m.logger.Error("failed to send NDP NA", "err", err)
	}
}

// startHeal sends 4 healing rounds (F24)
func (m *Manager) startHeal(tl *targetLoop) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				m.logger.Error("heal panic", "mac", tl.mac, "err", r)
			}
		}()

		m.mu.Lock()
		gatewayIPv4, gatewayIPv6 := m.gatewayIPv4, m.gatewayIPv6
		gatewayMacIPv4, gatewayMacIPv6 := m.gatewayMacIPv4, m.gatewayMacIPv6
		m.mu.Unlock()

		// F24: 4 rounds, 1.2s apart, truthful ARP/NAs
		for i := 0; i < 4; i++ {
			// Check if re-blocked (F24: skip if re-blocked)
			m.mu.Lock()
			if _, reblocked := m.targets[tl.mac]; reblocked {
				m.mu.Unlock()
				return
			}
			m.mu.Unlock()

			// Send truthful replies
			conn, err := packet.Listen(m.lanIface, packet.Raw, 0, nil)
			if err == nil {
				for _, ip := range tl.ips {
					if ip.To4() != nil && gatewayIPv4 != nil && len(gatewayMacIPv4) > 0 {
						m.sendARPReply(conn, ip, gatewayMacIPv4)
					}
					if ip.To4() == nil && gatewayIPv6 != nil && len(gatewayMacIPv6) > 0 {
						m.sendNDPNA(conn, ip, gatewayMacIPv6)
					}
				}
				conn.Close()
			}

			if i < 3 {
				time.Sleep(1200 * time.Millisecond)
			}
		}
	}()
}

// gatewayLoop detects gateway IPs and MACs every 30s (F25)
func (m *Manager) gatewayLoop() {
	defer func() {
		if r := recover(); r != nil {
			m.logger.Error("gateway loop panic", "err", r)
		}
	}()

	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		m.syncGatewayFacts()
	}
}

// syncGatewayFacts detects gateway IPs and MACs via netlink and ARP/ND
func (m *Manager) syncGatewayFacts() {
	// F25: v4 gateway from default route
	routes, _ := netlink.RouteList(nil, netlink.FAMILY_V4)
	for _, r := range routes {
		if r.Dst == nil && r.Gw != nil {
			m.mu.Lock()
			m.gatewayIPv4 = r.Gw
			m.mu.Unlock()
			break
		}
	}

	// F25: v6 gateway from route to 2000::/pinned to LAN_IFACE
	routes, _ = netlink.RouteList(nil, netlink.FAMILY_V6)
	for _, r := range routes {
		if r.LinkIndex == m.lanIface.Index && r.Dst != nil {
			if _, net2000, _ := net.ParseCIDR("2000::/3"); net2000 != nil && net2000.Contains(r.Dst.IP) {
				m.mu.Lock()
				m.gatewayIPv6 = r.Gw
				m.mu.Unlock()
				break
			}
		}
	}

	// F25: Gateway MACs via netlink neighbor table, else solicit
	m.resolveGatewayMACs()
}

// resolveGatewayMACs looks up gateway MACs via netlink or ARP solicit
func (m *Manager) resolveGatewayMACs() {
	m.mu.Lock()
	gw4, gw6 := m.gatewayIPv4, m.gatewayIPv6
	m.mu.Unlock()

	if gw4 != nil {
		neighs, _ := netlink.NeighList(m.lanIface.Index, netlink.FAMILY_V4)
		for _, n := range neighs {
			if n.IP.Equal(gw4) && len(n.HardwareAddr) > 0 {
				m.mu.Lock()
				m.gatewayMacIPv4 = n.HardwareAddr
				m.mu.Unlock()
				return
			}
		}
		// TODO: solicit with 2s wait if not found (F25)
	}

	if gw6 != nil {
		neighs, _ := netlink.NeighList(m.lanIface.Index, netlink.FAMILY_V6)
		for _, n := range neighs {
			if n.IP.Equal(gw6) && len(n.HardwareAddr) > 0 {
				m.mu.Lock()
				m.gatewayMacIPv6 = n.HardwareAddr
				m.mu.Unlock()
				return
			}
		}
		// TODO: solicit with 2s wait if not found (F25)
	}
}

// Stop halts all spoofing and healing
func (m *Manager) Stop() {
	m.mu.Lock()
	defer m.mu.Unlock()

	for _, loop := range m.targets {
		loop.cancel()
	}
	m.targets = make(map[string]*targetLoop)
}

// Errors
var (
	ErrNoPortalIP = errType("no portal IP found")
)

type errType string

func (e errType) Error() string { return string(e) }
