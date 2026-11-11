package workaround

import (
	"sort"
	"testing"
)

func TestNewManager(t *testing.T) {
	m := New(1000)
	if m == nil {
		t.Fatal("manager is nil")
	}
	if m.maxMACs != 1000 {
		t.Fatalf("maxMACs not set: %d", m.maxMACs)
	}
}

func TestLoadDomains(t *testing.T) {
	m := New(1000)

	domains := `
example.com vpn
test.example.com proxy
cdn.example.com private_dns
deep.test.example.com tor
`

	err := m.LoadDomains(domains)
	if err != nil {
		t.Fatalf("failed to load domains: %v", err)
	}

	// Check that domains were loaded
	m.mu.RLock()
	if len(m.domains) != 4 {
		t.Fatalf("expected 4 domains, got %d", len(m.domains))
	}
	m.mu.RUnlock()
}

func TestMatchDomainExact(t *testing.T) {
	m := New(1000)
	m.LoadDomains("example.com vpn")

	cats := m.MatchDomain("example.com")
	if len(cats) != 1 || cats[0] != "vpn" {
		t.Fatalf("exact match failed: %v", cats)
	}
}

func TestMatchDomainSubdomain(t *testing.T) {
	m := New(1000)
	m.LoadDomains("example.com vpn")

	// Subdomain should match parent
	cats := m.MatchDomain("sub.example.com")
	if len(cats) != 1 || cats[0] != "vpn" {
		t.Fatalf("subdomain match failed: %v", cats)
	}

	// Deep subdomain should match parent
	cats = m.MatchDomain("deep.sub.example.com")
	if len(cats) != 1 || cats[0] != "vpn" {
		t.Fatalf("deep subdomain match failed: %v", cats)
	}
}

func TestMatchDomainLongestSuffix(t *testing.T) {
	m := New(1000)
	domains := `
example.com vpn
test.example.com proxy
`
	m.LoadDomains(domains)

	// test.example.com should match proxy (longer suffix)
	cats := m.MatchDomain("test.example.com")
	if len(cats) != 1 || cats[0] != "proxy" {
		t.Fatalf("longest suffix match failed: %v", cats)
	}

	// other.example.com should match vpn (shorter suffix)
	cats = m.MatchDomain("other.example.com")
	if len(cats) != 1 || cats[0] != "vpn" {
		t.Fatalf("fallback to shorter suffix failed: %v", cats)
	}
}

func TestMatchDomainCaseInsensitive(t *testing.T) {
	m := New(1000)
	m.LoadDomains("Example.COM vpn")

	cats := m.MatchDomain("EXAMPLE.COM")
	if len(cats) != 1 || cats[0] != "vpn" {
		t.Fatalf("case insensitive match failed: %v", cats)
	}

	cats = m.MatchDomain("Sub.Example.COM")
	if len(cats) != 1 || cats[0] != "vpn" {
		t.Fatalf("case insensitive subdomain match failed: %v", cats)
	}
}

func TestMatchDomainTrailingDot(t *testing.T) {
	m := New(1000)
	m.LoadDomains("example.com vpn")

	// Should work with trailing dot
	cats := m.MatchDomain("example.com.")
	if len(cats) != 1 || cats[0] != "vpn" {
		t.Fatalf("match with trailing dot failed: %v", cats)
	}
}

func TestMatchDomainNoMatch(t *testing.T) {
	m := New(1000)
	m.LoadDomains("example.com vpn")

	cats := m.MatchDomain("notfound.com")
	if len(cats) != 0 {
		t.Fatalf("should not match unknown domain: %v", cats)
	}
}

func TestLoadDomainsSkipsInvalid(t *testing.T) {
	m := New(1000)

	domains := `
example.com vpn
invalid-category
test.com proxy
incomplete
example.org invalid_cat
`

	m.LoadDomains(domains)

	// Should load only valid entries
	cats := m.MatchDomain("example.com")
	if len(cats) != 1 {
		t.Fatalf("failed to load valid domain: %v", cats)
	}

	cats = m.MatchDomain("test.com")
	if len(cats) != 1 {
		t.Fatalf("failed to load second valid domain: %v", cats)
	}

	cats = m.MatchDomain("example.org")
	if len(cats) != 0 {
		t.Fatalf("should skip invalid category: %v", cats)
	}
}

func TestUpdateIPToMACMap(t *testing.T) {
	m := New(1000)

	mapping := map[string]string{
		"192.168.1.100": "aa:bb:cc:dd:ee:ff",
		"192.168.1.101": "aa:bb:cc:dd:ee:00",
	}

	m.UpdateIPToMACMap(mapping)

	m.mu.RLock()
	if len(m.ipToMACMap) != 2 {
		t.Fatalf("IP to MAC map not updated")
	}
	m.mu.RUnlock()
}

func TestGetWorkaroundsByMAC(t *testing.T) {
	m := New(1000)

	// GetWorkaroundsByMAC currently returns empty
	// This test verifies it doesn't crash
	cats := m.GetWorkaroundsByMAC("aa:bb:cc:dd:ee:ff")
	if len(cats) != 0 {
		t.Fatalf("expected empty categories: %v", cats)
	}
}

func TestClearMatches(t *testing.T) {
	m := New(1000)

	m.mu.Lock()
	m.macCount = 10
	m.mu.Unlock()

	m.ClearMatches()

	m.mu.RLock()
	if m.macCount != 0 {
		t.Fatalf("macCount not cleared: %d", m.macCount)
	}
	m.mu.RUnlock()
}

func TestCategoryConstants(t *testing.T) {
	if CategoryVPN != "vpn" {
		t.Fatal("CategoryVPN constant is wrong")
	}
	if CategoryPrivateDNS != "private_dns" {
		t.Fatal("CategoryPrivateDNS constant is wrong")
	}
	if CategoryProxy != "proxy" {
		t.Fatal("CategoryProxy constant is wrong")
	}
	if CategoryTor != "tor" {
		t.Fatal("CategoryTor constant is wrong")
	}
}

func TestMultipleCategoriesPerDomain(t *testing.T) {
	m := New(1000)

	domains := `
example.com vpn
example.com proxy
`

	m.LoadDomains(domains)

	cats := m.MatchDomain("example.com")
	if len(cats) != 2 {
		t.Fatalf("expected 2 categories, got %d", len(cats))
	}

	// Should be sorted
	sort.Strings(cats)
	if cats[0] != "proxy" || cats[1] != "vpn" {
		t.Fatalf("categories not sorted: %v", cats)
	}
}

// Benchmark domain matching
func BenchmarkMatchDomain(b *testing.B) {
	m := New(1000)

	domains := `
vpn.example.com vpn
private.example.com private_dns
proxy.cdn.example.com proxy
tor.onion.example.com tor
test.sub.example.com vpn
`

	m.LoadDomains(domains)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		m.MatchDomain("deep.sub.test.sub.example.com")
		m.MatchDomain("vpn.example.com")
		m.MatchDomain("private.example.com")
	}
}
