package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Config holds blocker configuration from environment and secrets
type Config struct {
	BackendURL         string
	InternalToken      string
	LANIface           string
	DataDir            string
	BlockerPort        int
	BlockerBind        []string // comma-separated addresses
	BlockerURLHost     string
	ScanInterval       float64
	ReconcileInterval  float64
	ResistInterval     float64
	PortalRedirectURL  string
	MirrorIface        string
}

// Load parses configuration from environment variables and secrets file
func Load() (*Config, error) {
	dataDir := os.Getenv("DATA_DIR")
	if dataDir == "" {
		dataDir = "/data"
	}

	token := os.Getenv("INTERNAL_TOKEN")
	if token == "" {
		var err error
		token, err = loadTokenFromSecrets(dataDir)
		if err != nil {
			return nil, fmt.Errorf("failed to load token from secrets: %w", err)
		}
	}

	if token == "" {
		return nil, fmt.Errorf("INTERNAL_TOKEN not set in env or secrets.json")
	}

	// Parse BlockerBind - comma-separated addresses
	bindStr := os.Getenv("BLOCKER_BIND")
	if bindStr == "" {
		bindStr = "127.0.0.1"
	}
	bindAddrs := []string{}
	for _, addr := range strings.Split(bindStr, ",") {
		addr = strings.TrimSpace(addr)
		if addr != "" {
			bindAddrs = append(bindAddrs, addr)
		}
	}

	// Parse port
	portStr := os.Getenv("BLOCKER_PORT")
	if portStr == "" {
		portStr = "7777"
	}
	port, err := strconv.Atoi(portStr)
	if err != nil {
		return nil, fmt.Errorf("BLOCKER_PORT must be an integer: %w", err)
	}

	// Parse intervals as floats
	scanInterval := 20.0
	if s := os.Getenv("SCAN_INTERVAL"); s != "" {
		f, err := strconv.ParseFloat(s, 64)
		if err != nil {
			return nil, fmt.Errorf("SCAN_INTERVAL must be a float: %w", err)
		}
		scanInterval = f
	}

	reconcileInterval := 30.0
	if s := os.Getenv("RECONCILE_INTERVAL"); s != "" {
		f, err := strconv.ParseFloat(s, 64)
		if err != nil {
			return nil, fmt.Errorf("RECONCILE_INTERVAL must be a float: %w", err)
		}
		reconcileInterval = f
	}

	resistInterval := 15.0
	if s := os.Getenv("RESIST_INTERVAL"); s != "" {
		f, err := strconv.ParseFloat(s, 64)
		if err != nil {
			return nil, fmt.Errorf("RESIST_INTERVAL must be a float: %w", err)
		}
		resistInterval = f
	}

	return &Config{
		BackendURL:        getEnvOrDefault("BACKEND_URL", "http://backend:8000"),
		InternalToken:     token,
		LANIface:          os.Getenv("LAN_IFACE"),
		DataDir:           dataDir,
		BlockerPort:       port,
		BlockerBind:       bindAddrs,
		BlockerURLHost:    os.Getenv("BLOCKER_URL_HOST"),
		ScanInterval:      scanInterval,
		ReconcileInterval: reconcileInterval,
		ResistInterval:    resistInterval,
		PortalRedirectURL: getEnvOrDefault("PORTAL_REDIRECT_URL", "http://task4ce.local/kid"),
		MirrorIface:       os.Getenv("MIRROR_IFACE"),
	}, nil
}

// getEnvOrDefault returns an environment variable or a default value
func getEnvOrDefault(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}

// loadTokenFromSecrets reads INTERNAL_TOKEN from secrets.json
func loadTokenFromSecrets(dataDir string) (string, error) {
	secretsPath := filepath.Join(dataDir, "secrets.json")

	data, err := os.ReadFile(secretsPath)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", fmt.Errorf("failed to read secrets.json: %w", err)
	}

	var secrets map[string]string
	if err := json.Unmarshal(data, &secrets); err != nil {
		return "", fmt.Errorf("failed to parse secrets.json: %w", err)
	}

	return secrets["INTERNAL_TOKEN"], nil
}
