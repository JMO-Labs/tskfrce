package service

import (
	"context"

	"github.com/jmo-labs/tskfrce/blocker/internal/config"
)

// Service orchestrates all blocker subsystems
type Service struct {
	cfg *config.Config
}

// New creates a new blocker service
func New(cfg *config.Config) *Service {
	return &Service{cfg: cfg}
}

// Run starts the service and blocks until context is cancelled
func (s *Service) Run(ctx context.Context) error {
	// TODO: Implement service orchestration
	return nil
}
