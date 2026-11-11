package config

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"
)

// Config holds blocker configuration from environment and secrets
type Config struct {
	BackendURL         string
	InternalToken      string
	LANIface           string
	DataDir            string
	BlockerPort        int
	BlockerBind        string
	BlockerURLHost     string
	ScanInterval       float64
	ReconcileInterval  float64
	ResistInterval     float64
	PortalRedirectURL  string
	MirrorIface        string
}

// Load parses configuration from environment variables and secrets file
func Load() (*Config, error) {
	// TODO: Implement config loading
	return &Config{}, nil
}

// loadTokenFromSecrets reads INTERNAL_TOKEN from secrets.json
func loadTokenFromSecrets(dataDir string) (string, error) {
	// TODO: Implement secrets file parsing
	return "", nil
}
