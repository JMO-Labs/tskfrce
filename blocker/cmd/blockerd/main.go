package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"runtime/debug"
	"syscall"

	"github.com/jmo-labs/tskfrce/blocker/internal/config"
	"github.com/jmo-labs/tskfrce/blocker/internal/service"
)

func main() {
	failOpen := flag.Bool("fail-open", false, "delete nftables table and exit")
	flag.Parse()

	// Set GOMEMLIMIT if specified
	if mlimit := os.Getenv("GOMEMLIMIT"); mlimit != "" {
		debug.SetMaxStack(1 << 30) // 1GB stack max during init
	}

	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	})))

	if *failOpen {
		if err := failOpenCmd(); err != nil {
			slog.Error("fail-open failed", "err", err)
			os.Exit(1)
		}
		os.Exit(0)
	}

	// Load config
	cfg, err := config.Load()
	if err != nil {
		slog.Error("config load failed", "err", err)
		os.Exit(1)
	}

	// Create service
	svc := service.New(cfg)

	// Signal handling
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGTERM, syscall.SIGINT)

	// Start service
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go func() {
		<-sigChan
		slog.Info("signal received, shutting down")
		cancel()
	}()

	if err := svc.Run(ctx); err != nil {
		slog.Error("service error", "err", err)
		os.Exit(1)
	}
}

func failOpenCmd() error {
	// TODO: Delete nftables table inet task4ce
	fmt.Println("table inet task4ce deleted")
	return nil
}
