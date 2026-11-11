package api

import (
	"context"
	"net/http"

	"github.com/jmo-labs/tskfrce/blocker/internal/config"
	"github.com/jmo-labs/tskfrce/blocker/internal/store"
)

// Handler provides HTTP API endpoints
type Handler struct {
	cfg   *config.Config
	store *store.Store
}

// New creates a new API handler
func New(cfg *config.Config, store *store.Store) *Handler {
	return &Handler{cfg: cfg, store: store}
}

// Listen starts the HTTP server
func (h *Handler) Listen(ctx context.Context) error {
	// TODO: Implement HTTP API with F2-F8 requirements
	return nil
}

// Shutdown gracefully stops the server
func (h *Handler) Shutdown(ctx context.Context) error {
	// TODO: Implement graceful shutdown
	return nil
}
