package portal

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"testing"
	"time"

	"golang.org/x/net/dns/dnsmessage"
)

func TestNewPortal(t *testing.T) {
	logger := slog.Default()
	p := New(net.ParseIP("192.168.1.1"), "5353", "8080", "http://example.com", logger)
	if p == nil {
		t.Fatal("portal is nil")
	}
	if !p.portalIP.Equal(net.ParseIP("192.168.1.1")) {
		t.Fatal("portal IP not set correctly")
	}
}

func TestBuildDNSResponseA(t *testing.T) {
	logger := slog.Default()
	p := New(net.ParseIP("192.168.1.1"), "5353", "8080", "http://example.com", logger)

	req := &dnsmessage.Message{}
	req.ID = 1234
	req.Response = false
	req.OpCode = 0
	req.RecursionDesired = true

	q := dnsmessage.Question{
		Name:  dnsmessage.MustNewName("example.com."),
		Type:  dnsmessage.TypeA,
		Class: dnsmessage.ClassINET,
	}

	resp := p.buildDNSResponse(req, q)

	if !resp.Response {
		t.Fatal("response flag not set")
	}
	if len(resp.Answers) != 1 {
		t.Fatalf("expected 1 answer, got %d", len(resp.Answers))
	}
	if resp.Answers[0].Header.TTL != 30 {
		t.Fatalf("expected TTL 30, got %d", resp.Answers[0].Header.TTL)
	}
	if !resp.Authoritative {
		t.Fatal("Authoritative flag not set")
	}
	if !resp.RecursionAvailable {
		t.Fatal("RecursionAvailable flag not set")
	}
}

func TestBuildDNSResponseOtherType(t *testing.T) {
	logger := slog.Default()
	p := New(net.ParseIP("192.168.1.1"), "5353", "8080", "http://example.com", logger)

	req := &dnsmessage.Message{}
	req.ID = 1234
	req.Response = false
	req.OpCode = 0
	req.RecursionDesired = false

	q := dnsmessage.Question{
		Name:  dnsmessage.MustNewName("example.com."),
		Type:  dnsmessage.TypeMX,
		Class: dnsmessage.ClassINET,
	}

	resp := p.buildDNSResponse(req, q)

	if len(resp.Answers) != 0 {
		t.Fatalf("expected no answers for MX query, got %d", len(resp.Answers))
	}
	if resp.RCode != dnsmessage.RCodeSuccess {
		t.Fatal("expected NOERROR response")
	}
}

func TestUpdateIPToMACMap(t *testing.T) {
	logger := slog.Default()
	p := New(net.ParseIP("192.168.1.1"), "5353", "8080", "http://example.com", logger)

	mapping := map[string]string{
		"192.168.1.100": "aa:bb:cc:dd:ee:ff",
		"192.168.1.101": "aa:bb:cc:dd:ee:00",
	}
	p.UpdateIPToMACMap(mapping)

	if mac, exists := p.ipToMACMap["192.168.1.100"]; !exists || mac != "aa:bb:cc:dd:ee:ff" {
		t.Fatal("IP to MAC mapping not updated correctly")
	}
}

func TestSetHitsFunc(t *testing.T) {
	logger := slog.Default()
	p := New(net.ParseIP("192.168.1.1"), "5353", "8080", "http://example.com", logger)

	called := false
	p.SetHitsFunc(func(mac string) error {
		called = true
		return nil
	})

	if p.hitsFunc == nil {
		t.Fatal("hitsFunc not set")
	}

	p.hitsFunc("aa:bb:cc:dd:ee:ff")
	if !called {
		t.Fatal("hitsFunc not called")
	}
}

func TestHandleHTTPRedirect(t *testing.T) {
	logger := slog.Default()
	p := New(net.ParseIP("192.168.1.1"), "5353", "8080", "http://task4ce.local/kid", logger)

	hitsCalled := false
	p.SetHitsFunc(func(mac string) error {
		hitsCalled = true
		return nil
	})

	p.UpdateIPToMACMap(map[string]string{"127.0.0.1": "aa:bb:cc:dd:ee:ff"})

	// Create test request
	req := &http.Request{
		Method:     "GET",
		RemoteAddr: "127.0.0.1:12345",
	}

	// Create test response writer
	rw := &testResponseWriter{
		header: make(http.Header),
		body:   []byte{},
	}

	p.handleHTTPRedirect(rw, req)

	if rw.statusCode != http.StatusFound {
		t.Fatalf("expected status 302, got %d", rw.statusCode)
	}
	if rw.header.Get("Location") != "http://task4ce.local/kid" {
		t.Fatalf("expected Location header, got %s", rw.header.Get("Location"))
	}
	if rw.header.Get("Content-Length") != "0" {
		t.Fatalf("expected Content-Length: 0, got %s", rw.header.Get("Content-Length"))
	}
	if !hitsCalled {
		t.Fatal("hits callback not called")
	}
}

func TestListenHTTPShutdown(t *testing.T) {
	logger := slog.Default()
	p := New(net.ParseIP("192.168.1.1"), "5353", "9090", "http://task4ce.local/kid", logger)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Start listener
	err := p.ListenHTTP(ctx)
	if err != nil {
		t.Fatalf("failed to start HTTP listener: %v", err)
	}

	// Give it time to start
	time.Sleep(100 * time.Millisecond)

	// Shutdown
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer shutdownCancel()
	if err := p.Shutdown(shutdownCtx); err != nil {
		t.Fatalf("failed to shutdown: %v", err)
	}
}

// testResponseWriter implements http.ResponseWriter
type testResponseWriter struct {
	statusCode int
	header     http.Header
	body       []byte
}

func (rw *testResponseWriter) Header() http.Header {
	return rw.header
}

func (rw *testResponseWriter) Write(b []byte) (int, error) {
	rw.body = append(rw.body, b...)
	return len(b), nil
}

func (rw *testResponseWriter) WriteHeader(code int) {
	rw.statusCode = code
}

func TestDNSPackUnpack(t *testing.T) {
	// Create a simple DNS query
	msg := dnsmessage.Message{}
	msg.ID = 1234
	msg.Response = false
	msg.OpCode = 0
	msg.RecursionDesired = true
	msg.Questions = []dnsmessage.Question{
		{
			Name:  dnsmessage.MustNewName("example.com."),
			Type:  dnsmessage.TypeA,
			Class: dnsmessage.ClassINET,
		},
	}

	packed, err := msg.Pack()
	if err != nil {
		t.Fatalf("failed to pack DNS message: %v", err)
	}

	var unpacked dnsmessage.Message
	if err := unpacked.Unpack(packed); err != nil {
		t.Fatalf("failed to unpack DNS message: %v", err)
	}

	if unpacked.ID != 1234 {
		t.Fatalf("ID mismatch: %d", unpacked.ID)
	}
	if len(unpacked.Questions) != 1 {
		t.Fatalf("question count mismatch: %d", len(unpacked.Questions))
	}
}

// Benchmark DNS response building
func BenchmarkBuildDNSResponse(b *testing.B) {
	logger := slog.Default()
	p := New(net.ParseIP("192.168.1.1"), "5353", "8080", "http://example.com", logger)

	req := &dnsmessage.Message{}
	req.ID = 1234
	req.Response = false
	req.OpCode = 0
	req.RecursionDesired = true

	q := dnsmessage.Question{
		Name:  dnsmessage.MustNewName("example.com."),
		Type:  dnsmessage.TypeA,
		Class: dnsmessage.ClassINET,
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		p.buildDNSResponse(req, q)
	}
}
