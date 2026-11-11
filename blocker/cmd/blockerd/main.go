package main

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"runtime/debug"
	"syscall"

	"github.com/google/nftables"
	"github.com/jmo-labs/tskfrce/blocker/internal/config"
	"github.com/jmo-labs/tskfrce/blocker/internal/firewall"
	"github.com/jmo-labs/tskfrce/blocker/internal/service"
)

func main() {
	failOpen := flag.Bool("fail-open", false, "delete nftables table and exit")
	flag.Parse()

	// Initialize JSON logging (before any slog calls)
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	})))

	// Handle fail-open subcommand separately
	if *failOpen {
		if err := failOpenCmd(); err != nil {
			slog.Error("fail-open failed", "err", err)
			os.Exit(1)
		}
		os.Exit(0)
	}

	// Set GOMEMLIMIT if specified in environment
	if mlimit := os.Getenv("GOMEMLIMIT"); mlimit != "" {
		debug.SetMaxStack(1 << 30) // 1GB stack max during init
	}

	// Load configuration from environment and secrets.json
	cfg, err := config.Load()
	if err != nil {
		slog.Error("config load failed", "err", err)
		os.Exit(1)
	}

	// Create and run service with graceful signal handling
	svc := service.New(cfg)

	// Setup signal handling for SIGTERM and SIGINT
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGTERM, syscall.SIGINT)

	// Create cancellable context for service
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Start signal handler goroutine
	go func() {
		sig := <-sigChan
		slog.Info("signal received, initiating graceful shutdown", "signal", sig.String())
		cancel()
	}()

	// Run service and block until context is cancelled
	if err := svc.Run(ctx); err != nil {
		slog.Error("service error", "err", err)
		os.Exit(1)
	}

	slog.Info("service exited cleanly")
}

// failOpenCmd deletes the nftables table (F58; used as systemd ExecStopPost)
func failOpenCmd() error {
	// Create netlink connection
	conn, err := nftables.New()
	if err != nil {
		slog.Warn("could not create netlink connection, table may remain", "err", err)
		// Fail-open is fail-safe: log and continue
		return nil
	}

	// Flush and delete the table (F58, finally)
	table := &nftables.Table{
		Family: nftables.TableFamilyINet,
		Name:   firewall.TABLE,
	}

	// Delete the table atomically
	conn.FlushTable(table)

	if err := conn.Flush(); err != nil {
		slog.Warn("could not delete nftables table", "err", err)
		// Still return nil; fail-open means we tried our best
		return nil
	}

	slog.Info("nftables table deleted")
	return nil
}
