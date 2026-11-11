package service

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jmo-labs/tskfrce/blocker/internal/api"
	"github.com/jmo-labs/tskfrce/blocker/internal/backend"
	"github.com/jmo-labs/tskfrce/blocker/internal/config"
	"github.com/jmo-labs/tskfrce/blocker/internal/discovery"
	"github.com/jmo-labs/tskfrce/blocker/internal/firewall"
	"github.com/jmo-labs/tskfrce/blocker/internal/portal"
	"github.com/jmo-labs/tskfrce/blocker/internal/redirect"
	"github.com/jmo-labs/tskfrce/blocker/internal/resist"
	"github.com/jmo-labs/tskfrce/blocker/internal/sites"
	"github.com/jmo-labs/tskfrce/blocker/internal/store"
	"github.com/jmo-labs/tskfrce/blocker/internal/vlan"
)

// Service orchestrates all blocker subsystems (F56-F60)
type Service struct {
	cfg        *config.Config
	store      *store.Store
	api        *api.Handler
	backend    *backend.Client
	fw         *firewall.Firewall
	redirect   *redirect.Manager
	resist     *resist.Counter
	discovery  *discovery.Scanner
	vlanDetect *vlan.Detector
	portal     *portal.Portal
	sites      *sites.Manager
	logger     *slog.Logger
}

// New creates a new blocker service with all subsystems
func New(cfg *config.Config) *Service {
	logger := slog.Default()
	redir, _ := redirect.New(cfg.LANIface, logger)
	vd, _ := vlan.New(cfg.LANIface, cfg.MirrorIface, logger)
	st := store.New()
	return &Service{
		cfg: cfg, store: st, api: api.New(cfg, st),
		backend: backend.New(cfg), fw: firewall.New(), redirect: redir,
		resist: resist.NewCounter("", []string{}, []string{}, cfg.ResistInterval, 20),
		discovery: discovery.NewScanner(cfg.LANIface), vlanDetect: vd,
		portal: portal.New(nil, "53", "80", cfg.PortalRedirectURL, logger),
		sites: sites.New(cfg.LANIface, logger), logger: logger,
	}
}

// Run starts the service and blocks until context is cancelled (F56-F60)
func (s *Service) Run(ctx context.Context) error {
	s.logger.Info("blocker service starting")
	firewall.EnableForwarding()
	if s.redirect == nil {
		return fmt.Errorf("redirect manager initialization failed")
	}

	stops := make(map[string]chan struct{})
	// F57: Startup order (F57: portal IP done, forwarding done, resist watch, reconcile, resist loop...)
	stops["resist-watch"] = s.startLoop(ctx, func() error {
		blocked := s.store.GetBlocked()
		targets := make(map[string]string)
		for _, mac := range blocked {
			targets[mac] = ""
		}
		s.resist.SetWatched(targets)
		return nil
	}, time.Duration(s.cfg.ResistInterval*1000)*time.Millisecond)

	s.reconcileOnce(ctx)

	// F22: Periodic reconcile to fetch updated covered_vlans from backend
	stops["reconcile"] = s.startLoop(ctx, func() error {
		s.reconcileOnce(ctx)
		return nil
	}, time.Duration(s.cfg.ReconcileInterval*1000)*time.Millisecond)

	stops["resist"] = s.startLoop(ctx, func() error {
		resisting := s.resist.Resisting()
		macs := make([]string, 0, len(resisting))
		for mac := range resisting {
			macs = append(macs, mac)
		}
		s.backend.ReportResisting(ctx, macs)
		return nil
	}, time.Duration(s.cfg.ResistInterval*1000)*time.Millisecond)

	stops["discovery"] = s.startLoop(ctx, func() error {
		s.discovery.ScanOnce(func(seen *backend.Seen) {
			s.backend.ReportSeen(ctx, seen)
		})
		return nil
	}, time.Duration(s.cfg.ScanInterval*1000)*time.Millisecond)

	if s.cfg.LANIface != "" || s.cfg.MirrorIface != "" {
		stops["vlan"] = s.startOnce(ctx, func() error {
			return s.vlanDetect.Start()
		})
	}

	stops["sites"] = s.startLoop(ctx, func() error {
		// F50: sync uses backend's covered_vlans from /state, not detector (F49 only listens)
		covered := s.store.GetCoveredVLANs()
		if len(covered) > 0 {
			return s.sites.Sync(covered)
		}
		return nil
	}, 60*time.Second)

	stops["dns"] = s.startOnce(ctx, func() error { return s.portal.ListenDNS(ctx) })
	stops["http"] = s.startOnce(ctx, func() error { return s.portal.ListenHTTP(ctx) })
	stops["api"] = s.startOnce(ctx, func() error { return s.api.Listen(ctx) })

	<-ctx.Done()
	s.logger.Info("shutdown signal received")
	return s.shutdown(ctx, stops)
}

// startLoop runs fn in a goroutine with panic recovery, at regular interval
func (s *Service) startLoop(ctx context.Context, fn func() error, interval time.Duration) chan struct{} {
	stop := make(chan struct{})
	go func() {
		defer func() {
			if r := recover(); r != nil {
				s.logger.Error("loop panic", "err", r)
			}
		}()
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-stop:
				return
			case <-ticker.C:
				if err := fn(); err != nil && ctx.Err() == nil {
					s.logger.Warn("loop error", "err", err)
				}
			}
		}
	}()
	return stop
}

// startOnce runs fn in a goroutine with panic recovery once (until context done)
func (s *Service) startOnce(ctx context.Context, fn func() error) chan struct{} {
	stop := make(chan struct{})
	go func() {
		defer func() {
			if r := recover(); r != nil {
				s.logger.Error("goroutine panic", "err", r)
			}
		}()
		if err := fn(); err != nil && ctx.Err() == nil {
			s.logger.Warn("service error", "err", err)
		}
	}()
	return stop
}

// reconcileOnce fetches state once at startup (F22, deviation 1)
func (s *Service) reconcileOnce(ctx context.Context) {
	if state, err := s.backend.GetState(ctx); err == nil && state != nil {
		s.store.SetBlocked(state.Blocked)
		s.store.SetListenOnly(state.ListenOnly)
		s.store.SetCoveredVLANs(state.CoveredVLANs) // F50: only backend drives covered_vlans
	}
}

// shutdown performs graceful shutdown (F58-F59)
func (s *Service) shutdown(ctx context.Context, stops map[string]chan struct{}) error {
	for _, stop := range stops {
		select {
		case stop <- struct{}{}:
		default:
		}
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
	defer cancel()

	if s.sites != nil {
		s.sites.Stop()
	}
	if s.redirect != nil {
		s.redirect.Stop()
	}
	if s.api != nil {
		s.api.Shutdown(shutdownCtx)
	}
	if s.fw != nil {
		s.fw.Delete(shutdownCtx)
	}

	s.logger.Info("shutdown complete")
	return nil
}
