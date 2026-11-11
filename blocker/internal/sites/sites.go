package sites

import (
	"fmt"
	"log/slog"
	"net"
	"sync"
	"time"

	"github.com/vishvananda/netlink"
)

// Manager manages VLAN site interfaces and DHCP (F50-F55)
type Manager struct {
	mu              sync.Mutex
	lanIface        string
	sites           map[uint16]*Site // VID -> Site
	logger          *slog.Logger
	createdIfaces   map[string]bool // Interface names created by us
}

// Site represents a VLAN site with its interface and DHCP state
type Site struct {
	VID         uint16
	IfaceName   string
	IPAddr      net.IP
	Gateway     net.IP
	Subnet      *net.IPNet
	IsActive    bool // Has valid lease
	CreatedByUs bool // Interface was created by box
	mu          sync.Mutex
}

// New creates a new sites manager
func New(lanIfaceName string, logger *slog.Logger) *Manager {
	return &Manager{
		lanIface:      lanIfaceName,
		sites:         make(map[uint16]*Site),
		createdIfaces: make(map[string]bool),
		logger:        logger,
	}
}

// Sync applies covered VLANs and creates/updates interfaces (F50)
func (m *Manager) Sync(coveredVLANs []uint16) error {
	if m.lanIface == "" {
		// F50: sync only when LAN_IFACE is set
		return nil
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	// Stop sites no longer in covered list
	for vid, site := range m.sites {
		found := false
		for _, cv := range coveredVLANs {
			if vid == cv {
				found = true
				break
			}
		}
		if !found {
			m.teardownSite(site)
			delete(m.sites, vid)
		}
	}

	// Create/update sites for covered VLANs
	for _, vid := range coveredVLANs {
		if _, exists := m.sites[vid]; !exists {
			site, err := m.createSite(vid)
			if err != nil {
				m.logger.Error("failed to create site", "vid", vid, "err", err)
				continue
			}
			m.sites[vid] = site
		}
	}

	return nil
}

// createSite creates a new VLAN site interface (F50)
func (m *Manager) createSite(vid uint16) (*Site, error) {
	// F50: Reuse <lan>.<vid> or br0.<vid>, else create <lan>.<vid>
	site := &Site{
		VID: vid,
	}

	// Try to find or create interface
	ifaceName := fmt.Sprintf("%s.%d", m.lanIface, vid)

	// Check if interface already exists
	iface, err := net.InterfaceByName(ifaceName)
	if err == nil {
		// Interface exists, reuse it (F50)
		site.IfaceName = iface.Name
		site.CreatedByUs = false
		m.logger.Info("reusing existing interface", "vid", vid, "iface", ifaceName)

		// Check for existing address
		addrs, _ := iface.Addrs()
		for _, addr := range addrs {
			if ipnet, ok := addr.(*net.IPNet); ok {
				site.IPAddr = ipnet.IP
				site.Subnet = ipnet
				site.IsActive = true
				break
			}
		}

		return site, nil
	}

	// Create new VLAN interface
	if err := m.createVLANInterface(ifaceName, vid); err != nil {
		return nil, err
	}

	site.IfaceName = ifaceName
	site.CreatedByUs = true
	m.createdIfaces[ifaceName] = true
	m.logger.Info("created new interface", "vid", vid, "iface", ifaceName)

	// Bring up interface
	if err := m.bringUpInterface(ifaceName); err != nil {
		m.logger.Error("failed to bring up interface", "iface", ifaceName, "err", err)
	}

	// Start DHCP (F50: busybox udhcpc if no address)
	m.startDHCP(site)

	// F50: New sites wait ≤15s for lease
	m.waitForLease(site, 15*time.Second)

	return site, nil
}

// createVLANInterface creates a VLAN interface using netlink
func (m *Manager) createVLANInterface(ifaceName string, vid uint16) error {
	// Get parent interface
	parent, err := netlink.LinkByName(m.lanIface)
	if err != nil {
		return fmt.Errorf("failed to get parent interface: %w", err)
	}

	// Create VLAN link
	vlan := &netlink.Vlan{
		LinkAttrs: netlink.LinkAttrs{
			Name:        ifaceName,
			ParentIndex: parent.Attrs().Index,
		},
		VlanId: int(vid),
	}

	if err := netlink.LinkAdd(vlan); err != nil {
		return fmt.Errorf("failed to create VLAN interface: %w", err)
	}

	return nil
}

// bringUpInterface brings a network interface up
func (m *Manager) bringUpInterface(ifaceName string) error {
	link, err := netlink.LinkByName(ifaceName)
	if err != nil {
		return err
	}

	return netlink.LinkSetUp(link)
}

// startDHCP starts DHCP on the site interface (F50)
// This is a placeholder; in production uses busybox udhcpc
func (m *Manager) startDHCP(site *Site) {
	// TODO: Start busybox udhcpc process
	// For now, just log
	m.logger.Info("starting DHCP", "iface", site.IfaceName, "vid", site.VID)
}

// waitForLease waits for DHCP lease with timeout (F50)
func (m *Manager) waitForLease(site *Site, timeout time.Duration) {
	deadline := time.Now().Add(timeout)
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			if time.Now().After(deadline) {
				m.logger.Warn("DHCP lease timeout", "iface", site.IfaceName)
				return
			}

			// Check if interface has an address
			iface, err := net.InterfaceByName(site.IfaceName)
			if err != nil {
				continue
			}

			addrs, _ := iface.Addrs()
			for _, addr := range addrs {
				if ipnet, ok := addr.(*net.IPNet); ok && ipnet.IP.To4() != nil {
					site.mu.Lock()
					site.IPAddr = ipnet.IP
					site.Subnet = ipnet
					site.IsActive = true
					site.mu.Unlock()
					m.logger.Info("DHCP lease acquired", "iface", site.IfaceName, "ip", ipnet.IP)
					return
				}
			}
		}
	}
}

// teardownSite removes a VLAN site (F53)
func (m *Manager) teardownSite(site *Site) {
	// F53: heal + stop watch, kill udhcpc, delete interface only if box created it
	m.logger.Info("tearing down site", "vid", site.VID, "iface", site.IfaceName)

	// Stop DHCP if running
	// TODO: Kill udhcpc process via pidfile

	// Delete interface only if we created it
	if site.CreatedByUs && m.createdIfaces[site.IfaceName] {
		if link, err := netlink.LinkByName(site.IfaceName); err == nil {
			if err := netlink.LinkDel(link); err != nil {
				m.logger.Error("failed to delete interface", "iface", site.IfaceName, "err", err)
			}
		}
		delete(m.createdIfaces, site.IfaceName)
	}
}

// GetSites returns current site information
func (m *Manager) GetSites() map[uint16]*Site {
	m.mu.Lock()
	defer m.mu.Unlock()

	result := make(map[uint16]*Site)
	for vid, site := range m.sites {
		result[vid] = site
	}
	return result
}

// Stop shuts down all sites
func (m *Manager) Stop() {
	m.mu.Lock()
	defer m.mu.Unlock()

	for _, site := range m.sites {
		m.teardownSite(site)
	}
	m.sites = make(map[uint16]*Site)
}

// GetInfrastructureExclusions returns gateway and box IPs for infrastructure exclusion (F54)
func (m *Manager) GetInfrastructureExclusions() (gateways []net.IP, boxIPs []net.IP) {
	m.mu.Lock()
	defer m.mu.Unlock()

	for _, site := range m.sites {
		if site.Gateway != nil {
			gateways = append(gateways, site.Gateway)
		}
		if site.IPAddr != nil {
			boxIPs = append(boxIPs, site.IPAddr)
		}
	}

	return gateways, boxIPs
}
