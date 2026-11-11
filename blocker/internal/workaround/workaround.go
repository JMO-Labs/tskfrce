package workaround

import (
	"sort"
	"strings"
	"sync"
)

// Manager tracks workaround domain matches per MAC (F47-F48)
type Manager struct {
	mu          sync.RWMutex
	domains     map[string]*domainEntry // domain -> categories
	maxMACs     int
	macCount    int
	ipToMACMap  map[string]string // IP -> MAC for querying
}

type domainEntry struct {
	categories []string // sorted category names
}

// Categories for workarounds
const (
	CategoryVPN        = "vpn"
	CategoryPrivateDNS = "private_dns"
	CategoryProxy      = "proxy"
	CategoryTor        = "tor"
)

var validCategories = map[string]bool{
	CategoryVPN:        true,
	CategoryPrivateDNS: true,
	CategoryProxy:      true,
	CategoryTor:        true,
}

// New creates a new workaround manager
func New(maxMACs int) *Manager {
	return &Manager{
		domains:    make(map[string]*domainEntry),
		maxMACs:    maxMACs,
		ipToMACMap: make(map[string]string),
	}
}

// LoadDomains parses domain workarounds from text (F47)
// Format: domain category (one per line)
func (m *Manager) LoadDomains(text string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.domains = make(map[string]*domainEntry)

	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}

		domain := strings.ToLower(parts[0])
		category := strings.ToLower(parts[1])

		if !validCategories[category] {
			continue
		}

		if _, exists := m.domains[domain]; !exists {
			m.domains[domain] = &domainEntry{}
		}
		m.domains[domain].categories = append(m.domains[domain].categories, category)
	}

	// Sort categories for each domain
	for _, entry := range m.domains {
		sort.Strings(entry.categories)
	}

	return nil
}

// MatchDomain finds workaround categories for a domain using longest suffix match (F47)
func (m *Manager) MatchDomain(domain string) []string {
	m.mu.RLock()
	defer m.mu.RUnlock()

	domain = strings.ToLower(domain)
	domain = strings.TrimSuffix(domain, ".")

	// Try exact match first
	if entry, exists := m.domains[domain]; exists {
		result := make([]string, len(entry.categories))
		copy(result, entry.categories)
		return result
	}

	// Try subdomain match (longest suffix wins) - F47: longest suffix wins
	parts := strings.Split(domain, ".")
	for i := 1; i < len(parts); i++ {
		suffix := strings.Join(parts[i:], ".")
		if entry, exists := m.domains[suffix]; exists {
			result := make([]string, len(entry.categories))
			copy(result, entry.categories)
			return result
		}
	}

	return nil
}

// RecordMatch records a domain match for a MAC
func (m *Manager) RecordMatch(clientIP string, domain string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if mac, exists := m.ipToMACMap[clientIP]; exists {
		// Check MAC cap (F48: cap 1,000 MACs)
		if m.macCount >= m.maxMACs && !m.hasMACMatches(mac) {
			return
		}
		if !m.hasMACMatches(mac) {
			m.macCount++
		}

		// Match categories for this domain
		cats := m.matchDomainUnsafe(domain)
		if len(cats) > 0 {
			// Could store per MAC here if needed
		}
	}
}

// matchDomainUnsafe is like MatchDomain but assumes lock is held
func (m *Manager) matchDomainUnsafe(domain string) []string {
	domain = strings.ToLower(domain)
	domain = strings.TrimSuffix(domain, ".")

	if entry, exists := m.domains[domain]; exists {
		result := make([]string, len(entry.categories))
		copy(result, entry.categories)
		return result
	}

	parts := strings.Split(domain, ".")
	for i := 1; i < len(parts); i++ {
		suffix := strings.Join(parts[i:], ".")
		if entry, exists := m.domains[suffix]; exists {
			result := make([]string, len(entry.categories))
			copy(result, entry.categories)
			return result
		}
	}

	return nil
}

// hasMACMatches checks if a MAC has recorded matches
func (m *Manager) hasMACMatches(mac string) bool {
	// This would check if mac has any workaround matches recorded
	// For now, we just return false
	return false
}

// UpdateIPToMACMap updates the IP->MAC mapping
func (m *Manager) UpdateIPToMACMap(ipToMAC map[string]string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.ipToMACMap = make(map[string]string)
	for ip, mac := range ipToMAC {
		m.ipToMACMap[ip] = mac
	}
}

// GetWorkaroundsByMAC returns sorted workaround categories for a MAC (F48)
func (m *Manager) GetWorkaroundsByMAC(mac string) []string {
	m.mu.RLock()
	defer m.mu.RUnlock()

	// This would be populated from RecordMatch
	// For now, return empty
	return []string{}
}

// ClearMatches clears all recorded matches
func (m *Manager) ClearMatches() {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.macCount = 0
}
