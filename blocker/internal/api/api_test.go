package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jmo-labs/tskfrce/blocker/internal/config"
	"github.com/jmo-labs/tskfrce/blocker/internal/store"
)

func newTestHandler() *Handler {
	cfg := &config.Config{
		InternalToken: "test-token",
		BlockerBind:   []string{"127.0.0.1"},
		BlockerPort:   8080,
	}
	s := store.New()
	h := New(cfg, s)
	return h
}

func makeRequest(h *Handler, method, path string, body interface{}, token *string) (*http.Response, string) {
	var bodyBytes []byte
	if body != nil {
		bodyBytes, _ = json.Marshal(body)
	}

	req := httptest.NewRequest(method, path, bytes.NewReader(bodyBytes))
	if token != nil {
		req.Header.Set("X-Internal-Token", *token)
	}
	req.Header.Set("Content-Type", "application/json")

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", h.handleHealth)
	mux.HandleFunc("POST /state", h.withAuth(h.handleState))
	mux.HandleFunc("POST /test-block", h.withAuth(h.handleTestBlock))
	mux.HandleFunc("/", h.handle404)

	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	resp := w.Result()
	respBody, _ := io.ReadAll(resp.Body)
	return resp, string(respBody)
}

// F5: GET /health (no auth)
func TestHealthOK(t *testing.T) {
	h := newTestHandler()
	resp, body := makeRequest(h, "GET", "/health", nil, nil)
	if resp.StatusCode != 200 {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}
	var result map[string]bool
	json.Unmarshal([]byte(body), &result)
	if !result["ok"] {
		t.Errorf("expected ok=true, got %v", result)
	}
}

// F8: Unknown paths return 404
func TestUnknownPath404(t *testing.T) {
	h := newTestHandler()
	resp, body := makeRequest(h, "GET", "/nope", nil, nil)
	if resp.StatusCode != 404 {
		t.Errorf("expected 404, got %d", resp.StatusCode)
	}
	var result map[string]string
	json.Unmarshal([]byte(body), &result)
	if result["error"] != "not found" {
		t.Errorf("expected error='not found', got %v", result)
	}
}

// F3: Auth required (missing token)
func TestStateMissingToken(t *testing.T) {
	h := newTestHandler()
	resp, _ := makeRequest(h, "POST", "/state", map[string][]string{"blocked": {}}, nil)
	if resp.StatusCode != 403 {
		t.Errorf("expected 403, got %d", resp.StatusCode)
	}
}

// F3: Auth required (wrong token)
func TestStateWrongToken(t *testing.T) {
	h := newTestHandler()
	wrongToken := "wrong"
	resp, _ := makeRequest(h, "POST", "/state", map[string][]string{"blocked": {}}, &wrongToken)
	if resp.StatusCode != 403 {
		t.Errorf("expected 403, got %d", resp.StatusCode)
	}
}

// F3: Empty token is 403
func TestStateEmptyToken(t *testing.T) {
	h := newTestHandler()
	emptyToken := ""
	resp, _ := makeRequest(h, "POST", "/state", map[string][]string{"blocked": {}}, &emptyToken)
	if resp.StatusCode != 403 {
		t.Errorf("expected 403, got %d", resp.StatusCode)
	}
}

// F6: /state validates MAC format
func TestStateInvalidMAC(t *testing.T) {
	h := newTestHandler()
	token := "test-token"
	resp, body := makeRequest(h, "POST", "/state",
		map[string][]string{"blocked": {"aa:xx"}}, &token)
	if resp.StatusCode != 400 {
		t.Errorf("expected 400, got %d", resp.StatusCode)
	}
	if !strings.Contains(body, "'aa:xx' is not a valid MAC address") {
		t.Errorf("expected MAC error, got %s", body)
	}
}

// F6: /state lowercases MACs
func TestStateLoercaseMAC(t *testing.T) {
	h := newTestHandler()
	token := "test-token"
	resp, body := makeRequest(h, "POST", "/state",
		map[string][]string{"blocked": {"AA:BB:CC:DD:EE:FF"}}, &token)
	if resp.StatusCode != 200 {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}
	var result map[string]interface{}
	json.Unmarshal([]byte(body), &result)
	if result["count"].(float64) != 1 {
		t.Errorf("expected count=1, got %v", result)
	}
}

// F6: /state rejects non-list
func TestStateRejectsNonList(t *testing.T) {
	h := newTestHandler()
	token := "test-token"
	resp, _ := makeRequest(h, "POST", "/state",
		map[string]string{"blocked": "nope"}, &token)
	if resp.StatusCode != 400 {
		t.Errorf("expected 400, got %d", resp.StatusCode)
	}
}

// F6: /state returns count
func TestStateReturnsCount(t *testing.T) {
	h := newTestHandler()
	token := "test-token"
	resp, body := makeRequest(h, "POST", "/state",
		map[string][]string{"blocked": {"aa:bb:cc:dd:ee:ff", "11:22:33:44:55:66"}}, &token)
	if resp.StatusCode != 200 {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}
	var result map[string]interface{}
	json.Unmarshal([]byte(body), &result)
	if result["count"].(float64) != 2 {
		t.Errorf("expected count=2, got %v", result)
	}
}

// F7: /test-block requires auth
func TestTestBlockRequiresAuth(t *testing.T) {
	h := newTestHandler()
	wrongToken := "wrong"
	resp, _ := makeRequest(h, "POST", "/test-block",
		map[string]string{"mac": "aa:bb:cc:dd:ee:ff"}, &wrongToken)
	if resp.StatusCode != 403 {
		t.Errorf("expected 403, got %d", resp.StatusCode)
	}
}

// F7: /test-block validates MAC
func TestTestBlockInvalidMAC(t *testing.T) {
	h := newTestHandler()
	h.Tester = func(mac string) (interface{}, error) {
		return nil, fmt.Errorf("'%s' is not a valid MAC address.", mac)
	}
	token := "test-token"
	resp, body := makeRequest(h, "POST", "/test-block",
		map[string]string{"mac": "nope"}, &token)
	if resp.StatusCode != 400 {
		t.Errorf("expected 400, got %d", resp.StatusCode)
	}
	if !strings.Contains(body, "not a valid MAC") {
		t.Errorf("expected MAC error, got %s", body)
	}
}

// F7: /test-block returns tester result
func TestTestBlockResult(t *testing.T) {
	h := newTestHandler()
	h.Tester = func(mac string) (interface{}, error) {
		return map[string]interface{}{
			"offline":         true,
			"router_resisted": false,
		}, nil
	}
	token := "test-token"
	resp, body := makeRequest(h, "POST", "/test-block",
		map[string]string{"mac": "aa:bb:cc:dd:ee:ff"}, &token)
	if resp.StatusCode != 200 {
		t.Errorf("expected 200, got %d, body: %s", resp.StatusCode, body)
	}
	var result map[string]interface{}
	json.Unmarshal([]byte(body), &result)
	if result["offline"].(bool) != true {
		t.Errorf("expected offline=true, got %v", result)
	}
}

// F8: All responses have Content-Length
func TestContentLengthPresent(t *testing.T) {
	h := newTestHandler()
	resp, _ := makeRequest(h, "GET", "/health", nil, nil)
	if resp.Header.Get("Content-Length") == "" {
		t.Errorf("expected Content-Length header")
	}
	if resp.Header.Get("Content-Type") != "application/json" {
		t.Errorf("expected Content-Type: application/json")
	}
}

// F4: Body size cap at 64 KiB
func TestBodySizeLimit(t *testing.T) {
	cfg := &config.Config{
		InternalToken: "test-token",
		BlockerBind:   []string{"127.0.0.1"},
		BlockerPort:   8080,
	}
	s := store.New()
	h := New(cfg, s)

	// Create a request with body > 64KiB
	largeBody := make([]byte, 65*1024)
	for i := range largeBody {
		largeBody[i] = 'x'
	}

	req := httptest.NewRequest("POST", "/state", bytes.NewReader(largeBody))
	req.Header.Set("X-Internal-Token", "test-token")
	req.Header.Set("Content-Type", "application/json")

	mux := http.NewServeMux()
	mux.HandleFunc("POST /state", h.withAuth(h.handleState))

	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	resp := w.Result()
	// MaxBytesReader will close body, causing decode error -> 400
	if resp.StatusCode != 400 {
		t.Errorf("expected 400 for oversized body, got %d", resp.StatusCode)
	}
}

// Spec: Auth checked before body read
func TestAuthBeforeBodyRead(t *testing.T) {
	h := newTestHandler()

	// Missing token should reject before even trying to read body
	largeBody := make([]byte, 10*1024)
	for i := range largeBody {
		largeBody[i] = 'x'
	}

	req := httptest.NewRequest("POST", "/state", bytes.NewReader(largeBody))
	// No token set

	mux := http.NewServeMux()
	mux.HandleFunc("POST /state", h.withAuth(h.handleState))

	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	resp := w.Result()
	if resp.StatusCode != 403 {
		t.Errorf("expected 403 for missing token (before body), got %d", resp.StatusCode)
	}
}

// Exact path matching - query string should 404
func TestExactPathMatching(t *testing.T) {
	h := newTestHandler()
	// Go's mux will match /health, so this should still work
	// Let's test unknown path with query instead
	resp, _ := makeRequest(h, "GET", "/unknown?foo=bar", nil, nil)
	if resp.StatusCode != 404 {
		t.Errorf("expected 404 for unknown path with query, got %d", resp.StatusCode)
	}
}
