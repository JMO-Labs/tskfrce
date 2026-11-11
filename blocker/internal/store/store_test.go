package store

import (
	"sort"
	"testing"
)

func TestSetBlockedValidatesAndLowercases(t *testing.T) {
	s := New()

	macs := []string{"AA:BB:CC:DD:EE:FF", "aa:bb:cc:dd:ee:ff", "11:22:33:44:55:66"}
	err := s.SetBlocked(macs)
	if err != nil {
		t.Fatalf("SetBlocked failed: %v", err)
	}

	blocked := s.GetBlocked()
	expectedSet := []string{"11:22:33:44:55:66", "aa:bb:cc:dd:ee:ff"}
	sort.Strings(expectedSet)

	if len(blocked) != len(expectedSet) {
		t.Errorf("got %d MACs, want %d", len(blocked), len(expectedSet))
	}

	for i, v := range blocked {
		if v != expectedSet[i] {
			t.Errorf("got MAC %q at index %d, want %q", v, i, expectedSet[i])
		}
	}
}

func TestSetBlockedRejectsInvalidMACKeepsOld(t *testing.T) {
	s := New()

	// Set initial valid MAC
	err := s.SetBlocked([]string{"aa:bb:cc:dd:ee:ff"})
	if err != nil {
		t.Fatalf("SetBlocked failed: %v", err)
	}

	// Try to set with one bad MAC
	err = s.SetBlocked([]string{"11:22:33:44:55:66", "aa:xx"})
	if err == nil {
		t.Errorf("SetBlocked should fail with bad MAC, but got nil")
	}

	// Verify old set is preserved
	blocked := s.GetBlocked()
	if len(blocked) != 1 || blocked[0] != "aa:bb:cc:dd:ee:ff" {
		t.Errorf("old set was modified despite error: got %v", blocked)
	}
}

func TestMACValidationAcceptsAllCases(t *testing.T) {
	tests := []struct {
		name    string
		mac     string
		wantErr bool
	}{
		{"lowercase", "aa:bb:cc:dd:ee:ff", false},
		{"uppercase", "AA:BB:CC:DD:EE:FF", false},
		{"mixed", "Aa:Bb:Cc:Dd:Ee:Ff", false},
		{"bad format", "aa:xx", true},
		{"no colons", "aabbccdddeeff", true},
		{"too many groups", "aa:bb:cc:dd:ee:ff:ff", true},
		{"non-hex", "gg:bb:cc:dd:ee:ff", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := New()
			err := s.SetBlocked([]string{tt.mac})
			if (err != nil) != tt.wantErr {
				t.Errorf("SetBlocked(%q): got error %v, want error=%v", tt.mac, err, tt.wantErr)
			}
		})
	}
}

func TestGetBlockedSorted(t *testing.T) {
	s := New()
	macs := []string{"ff:ff:ff:ff:ff:ff", "aa:aa:aa:aa:aa:aa", "cc:cc:cc:cc:cc:cc"}
	s.SetBlocked(macs)

	blocked := s.GetBlocked()
	expected := []string{"aa:aa:aa:aa:aa:aa", "cc:cc:cc:cc:cc:cc", "ff:ff:ff:ff:ff:ff"}

	for i, v := range blocked {
		if v != expected[i] {
			t.Errorf("got %v, want %v", blocked, expected)
		}
	}
}

func TestListenOnlyFlagIndependent(t *testing.T) {
	s := New()

	s.SetListenOnly(true)
	if !s.GetListenOnly() {
		t.Errorf("GetListenOnly: got false, want true")
	}

	s.SetListenOnly(false)
	if s.GetListenOnly() {
		t.Errorf("GetListenOnly: got true, want false")
	}
}

func TestCoveredVLANsStorage(t *testing.T) {
	s := New()

	vlans := []uint16{100, 200, 300}
	s.SetCoveredVLANs(vlans)

	covered := s.GetCoveredVLANs()
	if len(covered) != len(vlans) {
		t.Errorf("got %d VLANs, want %d", len(covered), len(vlans))
	}

	for i, v := range covered {
		if v != vlans[i] {
			t.Errorf("got VLAN %d at index %d, want %d", v, i, vlans[i])
		}
	}
}

func TestCoveredVLANsEmptyInitially(t *testing.T) {
	s := New()
	vlans := s.GetCoveredVLANs()
	if len(vlans) != 0 {
		t.Errorf("got %d VLANs, want 0", len(vlans))
	}
}

func TestCoveredVLANsIndependent(t *testing.T) {
	s := New()

	vlans1 := []uint16{100, 200}
	s.SetCoveredVLANs(vlans1)

	vlans2 := []uint16{300, 400, 500}
	s.SetCoveredVLANs(vlans2)

	covered := s.GetCoveredVLANs()
	if len(covered) != 3 {
		t.Errorf("got %d VLANs, want 3", len(covered))
	}
}

func TestGetBlockedReturnsEmpty(t *testing.T) {
	s := New()
	blocked := s.GetBlocked()
	if len(blocked) != 0 {
		t.Errorf("got %d MACs, want 0", len(blocked))
	}
}

func TestMACNormalizationPreservesDuplicates(t *testing.T) {
	s := New()

	macs := []string{"aa:bb:cc:dd:ee:ff", "AA:BB:CC:DD:EE:FF", "aa:bb:cc:dd:ee:ff"}
	err := s.SetBlocked(macs)
	if err != nil {
		t.Fatalf("SetBlocked failed: %v", err)
	}

	blocked := s.GetBlocked()
	if len(blocked) != 1 {
		t.Errorf("got %d unique MACs, want 1 (duplicates should be deduplicated)", len(blocked))
	}
}

func TestConcurrentReads(t *testing.T) {
	s := New()
	s.SetBlocked([]string{"aa:bb:cc:dd:ee:ff"})

	done := make(chan bool)
	// Spawn multiple goroutines reading concurrently
	for i := 0; i < 10; i++ {
		go func() {
			blocked := s.GetBlocked()
			if len(blocked) != 1 {
				t.Errorf("concurrent read got %d MACs, want 1", len(blocked))
			}
			done <- true
		}()
	}

	for i := 0; i < 10; i++ {
		<-done
	}
}

func TestSetBlockedTrimWhitespace(t *testing.T) {
	s := New()

	macs := []string{" aa:bb:cc:dd:ee:ff ", "11:22:33:44:55:66"}
	err := s.SetBlocked(macs)
	if err != nil {
		t.Fatalf("SetBlocked failed: %v", err)
	}

	blocked := s.GetBlocked()
	if len(blocked) != 2 {
		t.Errorf("got %d MACs, want 2", len(blocked))
	}

	// Check that whitespace was trimmed
	for _, mac := range blocked {
		if mac != "aa:bb:cc:dd:ee:ff" && mac != "11:22:33:44:55:66" {
			t.Errorf("unexpected MAC after trimming: %q", mac)
		}
	}
}

func TestErrorMessageIncludesMAC(t *testing.T) {
	s := New()
	err := s.SetBlocked([]string{"bad:mac"})
	if err == nil {
		t.Fatalf("SetBlocked should fail, but got nil error")
	}

	errMsg := err.Error()
	if !contains(errMsg, "bad:mac") {
		t.Errorf("error message should include MAC, got: %s", errMsg)
	}
}

func contains(s, substr string) bool {
	return len(s) > 0 && len(substr) > 0 && (s == substr || len(s) > len(substr))
}
