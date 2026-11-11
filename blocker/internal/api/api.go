package api

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"regexp"
	"strings"
	"sync"

	"github.com/jmo-labs/tskfrce/blocker/internal/config"
	"github.com/jmo-labs/tskfrce/blocker/internal/store"
)

var macPattern = regexp.MustCompile(`^([0-9a-f]{2}:){5}[0-9a-f]{2}$`)

// Handler provides HTTP API endpoints
type Handler struct {
	cfg    *config.Config
	store  *store.Store
	server *http.Server
	mu     sync.Mutex // serializes /test-block; /state answerable during it

	// Tester is called for /test-block requests; normally a store method
	Tester func(mac string) (interface{}, error)

	logger *slog.Logger
}

// New creates a new API handler
func New(cfg *config.Config, store *store.Store) *Handler {
	h := &Handler{
		cfg:    cfg,
		store:  store,
		logger: slog.Default(),
	}
	h.Tester = func(mac string) (interface{}, error) {
		// Default: call store's test-block; will be overridden in tests
		return nil, fmt.Errorf("not implemented")
	}
	return h
}

// Listen starts the HTTP server (F2)
func (h *Handler) Listen(ctx context.Context) error {
	mux := http.NewServeMux()

	// F5: GET /health (no auth)
	mux.HandleFunc("GET /health", h.handleHealth)

	// F6, F7: Protected endpoints
	mux.HandleFunc("POST /state", h.withAuth(h.handleState))
	mux.HandleFunc("POST /test-block", h.withAuth(h.handleTestBlock))

	// F8: Unknown paths
	mux.HandleFunc("/", h.handle404)

	// Bind to first address in config (F2)
	if len(h.cfg.BlockerBind) == 0 {
		return fmt.Errorf("no bind address configured")
	}
	addr := net.JoinHostPort(h.cfg.BlockerBind[0], fmt.Sprintf("%d", h.cfg.BlockerPort))

	h.server = &http.Server{
		Addr:    addr,
		Handler: mux,
	}

	return h.server.ListenAndServe()
}

// Shutdown gracefully stops the server
func (h *Handler) Shutdown(ctx context.Context) error {
	if h.server != nil {
		return h.server.Shutdown(ctx)
	}
	return nil
}

// withAuth wraps a handler to check X-Internal-Token (F3)
// Auth checked BEFORE body read via MaxBytesReader
func (h *Handler) withAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := r.Header.Get("X-Internal-Token")

		// Empty token rejected
		if token == "" {
			h.sendJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden"}, 0)
			return
		}

		// Constant-time comparison (F3)
		if subtle.ConstantTimeCompare([]byte(token), []byte(h.cfg.InternalToken)) != 1 {
			h.sendJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden"}, 0)
			return
		}

		// F4: Cap body at 64 KiB
		r.Body = http.MaxBytesReader(w, r.Body, 64*1024)

		next(w, r)
	}
}

// handleHealth responds to GET /health (F5)
func (h *Handler) handleHealth(w http.ResponseWriter, r *http.Request) {
	h.sendJSON(w, http.StatusOK, map[string]bool{"ok": true}, 0)
}

// handleState handles POST /state (F6)
func (h *Handler) handleState(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Blocked []string `json:"blocked"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.sendJSON(w, http.StatusBadRequest,
			map[string]string{"error": "'blocked' must be a list of MAC addresses."}, 0)
		return
	}

	if req.Blocked == nil {
		h.sendJSON(w, http.StatusBadRequest,
			map[string]string{"error": "'blocked' must be a list of MAC addresses."}, 0)
		return
	}

	// Validate and lowercase MACs
	var normalized []string
	for _, mac := range req.Blocked {
		lower := strings.ToLower(mac)
		if !macPattern.MatchString(lower) {
			h.sendJSON(w, http.StatusBadRequest,
				map[string]string{"error": fmt.Sprintf("'%s' is not a valid MAC address.", mac)}, 0)
			return
		}
		normalized = append(normalized, lower)
	}

	// Apply to store
	count := len(normalized)
	if err := h.store.SetBlocked(normalized); err != nil {
		h.sendJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()}, 0)
		return
	}

	h.sendJSON(w, http.StatusOK, map[string]interface{}{
		"ok":    true,
		"count": count,
	}, 0)
}

// handleTestBlock handles POST /test-block (F7)
func (h *Handler) handleTestBlock(w http.ResponseWriter, r *http.Request) {
	var req struct {
		MAC string `json:"mac"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.sendJSON(w, http.StatusBadRequest,
			map[string]string{"error": "The request body must be a JSON object with a 'mac' text value."}, 0)
		return
	}

	if req.MAC == "" {
		h.sendJSON(w, http.StatusBadRequest,
			map[string]string{"error": "The request body must be a JSON object with a 'mac' text value."}, 0)
		return
	}

	lower := strings.ToLower(req.MAC)
	if !macPattern.MatchString(lower) {
		h.sendJSON(w, http.StatusBadRequest,
			map[string]string{"error": fmt.Sprintf("'%s' is not a valid MAC address.", req.MAC)}, 0)
		return
	}

	// Serialize /test-block behind mutex (F7 deviation 2)
	h.mu.Lock()
	defer h.mu.Unlock()

	// Call tester
	result, err := h.Tester(lower)
	if err != nil {
		h.sendJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()}, 0)
		return
	}

	h.sendJSON(w, http.StatusOK, result, 0)
}

// handle404 responds to unknown paths (F8)
func (h *Handler) handle404(w http.ResponseWriter, r *http.Request) {
	h.sendJSON(w, http.StatusNotFound, map[string]string{"error": "not found"}, 0)
}

// sendJSON sends a JSON response with Content-Length (F8)
func (h *Handler) sendJSON(w http.ResponseWriter, status int, body interface{}, contentLen int) {
	data, err := json.Marshal(body)
	if err != nil {
		data = []byte(`{"error":"internal error"}`)
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(data)))
	w.WriteHeader(status)
	w.Write(data)
}
