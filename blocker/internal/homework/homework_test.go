package homework

import (
	"testing"
	"time"
)

func TestValidateHomeworkState(t *testing.T) {
	tests := []struct {
		name    string
		hw      *HomeworkState
		wantErr bool
		errMsg  string
	}{
		{
			name:    "nil state",
			hw:      nil,
			wantErr: false,
		},
		{
			name: "valid state",
			hw: &HomeworkState{
				Allow: []string{"google.com"},
				Block: []string{},
				Until: time.Now().Add(1 * time.Hour),
			},
			wantErr: false,
		},
		{
			name: "allow list exceeds limit",
			hw: &HomeworkState{
				Allow: make([]string, MaxNamesPerList+1),
				Block: []string{},
				Until: time.Now().Add(1 * time.Hour),
			},
			wantErr: true,
			errMsg:  "allow list exceeds",
		},
		{
			name: "block list exceeds limit",
			hw: &HomeworkState{
				Allow: []string{},
				Block: make([]string, MaxNamesPerList+1),
				Until: time.Now().Add(1 * time.Hour),
			},
			wantErr: true,
			errMsg:  "block list exceeds",
		},
		{
			name: "allow name too long",
			hw: &HomeworkState{
				Allow: []string{"a" + string(make([]byte, MaxNameLen))},
				Block: []string{},
				Until: time.Now().Add(1 * time.Hour),
			},
			wantErr: true,
			errMsg:  "exceeds 253 chars",
		},
		{
			name: "block name too long",
			hw: &HomeworkState{
				Allow: []string{},
				Block: []string{"b" + string(make([]byte, MaxNameLen))},
				Until: time.Now().Add(1 * time.Hour),
			},
			wantErr: true,
			errMsg:  "exceeds 253 chars",
		},
		{
			name: "until in the past",
			hw: &HomeworkState{
				Allow: []string{"google.com"},
				Block: []string{},
				Until: time.Now().Add(-1 * time.Hour),
			},
			wantErr: true,
			errMsg:  "in the past",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateHomeworkState(tt.hw)
			if (err != nil) != tt.wantErr {
				t.Errorf("ValidateHomeworkState() error = %v, wantErr %v", err, tt.wantErr)
			}
			if tt.wantErr && tt.errMsg != "" && (err == nil || !contains(err.Error(), tt.errMsg)) {
				t.Errorf("ValidateHomeworkState() error = %v, want to contain %q", err, tt.errMsg)
			}
		})
	}
}

func TestParseUntil(t *testing.T) {
	tests := []struct {
		name    string
		until   string
		wantErr bool
		check   func(t *testing.T, got time.Time)
	}{
		{
			name:    "valid RFC3339 with Z",
			until:   "2099-01-01T00:00:00Z",
			wantErr: false,
			check: func(t *testing.T, got time.Time) {
				if got.Year() != 2099 {
					t.Errorf("year = %d, want 2099", got.Year())
				}
			},
		},
		{
			name:    "valid RFC3339 with +00:00",
			until:   "2099-01-01T00:00:00+00:00",
			wantErr: false,
		},
		{
			name:    "valid RFC3339 with offset",
			until:   "2099-01-01T00:00:00-05:00",
			wantErr: false,
		},
		{
			name:    "invalid format",
			until:   "2099-01-01",
			wantErr: true,
		},
		{
			name:    "no timezone",
			until:   "2099-01-01T00:00:00",
			wantErr: true,
		},
		{
			name:    "malformed",
			until:   "not-a-date",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParseUntil(tt.until)
			if (err != nil) != tt.wantErr {
				t.Errorf("ParseUntil() error = %v, wantErr %v", err, tt.wantErr)
			}
			if !tt.wantErr && tt.check != nil {
				tt.check(t, got)
			}
		})
	}
}

func TestChunkActivity(t *testing.T) {
	tests := []struct {
		name     string
		count    int
		wantLen  int
		maxChunk int
	}{
		{
			name:     "empty",
			count:    0,
			wantLen:  0,
			maxChunk: 0,
		},
		{
			name:     "exact fit",
			count:    ActivityChunkSize,
			wantLen:  1,
			maxChunk: ActivityChunkSize,
		},
		{
			name:     "one extra",
			count:    ActivityChunkSize + 1,
			wantLen:  2,
			maxChunk: 1,
		},
		{
			name:     "multiple chunks",
			count:    ActivityChunkSize*3 + 100,
			wantLen:  4,
			maxChunk: 100,
		},
		{
			name:     "partial chunk",
			count:    100,
			wantLen:  1,
			maxChunk: 100,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			activities := make([]Activity, tt.count)
			for i := 0; i < tt.count; i++ {
				activities[i] = Activity{
					MAC:    "aa:bb:cc:dd:ee:ff",
					Domain: "example.com",
				}
			}

			chunks := ChunkActivity(activities)

			if len(chunks) != tt.wantLen {
				t.Errorf("ChunkActivity() len = %d, want %d", len(chunks), tt.wantLen)
			}

			if tt.wantLen > 0 && len(chunks[len(chunks)-1]) != tt.maxChunk {
				t.Errorf("last chunk size = %d, want %d", len(chunks[len(chunks)-1]), tt.maxChunk)
			}

			// Verify all chunks are within limit
			for i, chunk := range chunks {
				if len(chunk) > ActivityChunkSize {
					t.Errorf("chunk %d size = %d, exceeds max %d", i, len(chunk), ActivityChunkSize)
				}
			}
		})
	}
}

func TestTimeoutForPair(t *testing.T) {
	tests := []struct {
		name       string
		ttl        int
		now        time.Time
		until      time.Time
		wantMin    int
		wantMax    int
		wantExact  int
		haveExact  bool
	}{
		{
			name:      "ttl below minimum",
			ttl:       100,
			now:       time.Now(),
			until:     time.Now().Add(1 * time.Hour),
			wantMin:   MinTimeout,
			wantExact: MinTimeout,
			haveExact: true,
		},
		{
			name:      "ttl above maximum",
			ttl:       5000,
			now:       time.Now(),
			until:     time.Now().Add(10 * time.Hour),
			wantExact: MaxTimeout,
			haveExact: true,
		},
		{
			name:      "ttl in range",
			ttl:       600,
			now:       time.Now(),
			until:     time.Now().Add(1 * time.Hour),
			wantExact: 600,
			haveExact: true,
		},
		{
			name:    "ttl clamped by until",
			ttl:     10000,
			now:     time.Now(),
			until:   time.Now().Add(100 * time.Second),
			wantMax: 100,
		},
		{
			name:      "zero until (no deadline)",
			ttl:       600,
			now:       time.Now(),
			until:     time.Time{},
			wantExact: 600,
			haveExact: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := TimeoutForPair(tt.ttl, tt.now, tt.until)

			if tt.haveExact && got != tt.wantExact {
				t.Errorf("TimeoutForPair() = %d, want %d", got, tt.wantExact)
			}
			if !tt.haveExact {
				if tt.wantMin > 0 && got < tt.wantMin {
					t.Errorf("TimeoutForPair() = %d, want >= %d", got, tt.wantMin)
				}
				if tt.wantMax > 0 && got > tt.wantMax {
					t.Errorf("TimeoutForPair() = %d, want <= %d", got, tt.wantMax)
				}
			}

			// Always >= 1
			if got < 1 {
				t.Errorf("TimeoutForPair() = %d, want >= 1", got)
			}
		})
	}
}

func TestTimeoutForPairNeverPastUntil(t *testing.T) {
	// Ensure timeout never exceeds until deadline
	now := time.Now()
	until := now.Add(50 * time.Second)

	for ttl := 1; ttl <= 10000; ttl += 100 {
		got := TimeoutForPair(ttl, now, until)
		secondsUntil := int(until.Sub(now).Seconds())
		if got > secondsUntil {
			t.Errorf("ttl=%d: TimeoutForPair() = %d, exceeds until deadline %d", ttl, got, secondsUntil)
		}
	}
}

func contains(s, substr string) bool {
	return len(s) > 0 && len(substr) > 0 && (s == substr || (len(s) >= len(substr) && (s[:len(substr)] == substr || s[len(s)-len(substr):] == substr || findSubstring(s, substr))))
}

func findSubstring(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
