package portal

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"time"

	"golang.org/x/net/dns/dnsmessage"
)

// Portal handles DNS and HTTP capture for the captive portal
type Portal struct {
	dnsAddr          string
	httpAddr         string
	portalRedirectURL string
	portalIP         net.IP
	hitsFunc         func(mac string) error // Callback for hit recording
	ipToMACMap       map[string]string      // IP -> MAC mapping
	logger           *slog.Logger
	httpSrv          *http.Server
}

// New creates a new portal
func New(portalIP net.IP, dnsPort string, httpPort string, redirectURL string, logger *slog.Logger) *Portal {
	p := &Portal{
		dnsAddr:        net.JoinHostPort("0.0.0.0", dnsPort),
		httpAddr:       net.JoinHostPort("0.0.0.0", httpPort),
		portalRedirectURL: redirectURL,
		portalIP:       portalIP,
		ipToMACMap:     make(map[string]string),
		logger:         logger,
	}
	return p
}

// UpdateIPToMACMap updates the IP->MAC mapping (from store)
func (p *Portal) UpdateIPToMACMap(ipToMAC map[string]string) {
	p.ipToMACMap = make(map[string]string)
	for ip, mac := range ipToMAC {
		p.ipToMACMap[ip] = mac
	}
}

// ListenDNS starts the DNS listener on UDP :53 (F44)
func (p *Portal) ListenDNS(ctx context.Context) error {
	addr, err := net.ResolveUDPAddr("udp", p.dnsAddr)
	if err != nil {
		return err
	}

	conn, err := net.ListenUDP("udp", addr)
	if err != nil {
		return err
	}

	go func() {
		defer func() {
			if r := recover(); r != nil {
				p.logger.Error("DNS listener panic", "err", r)
			}
			conn.Close()
		}()

		// F28: Portal off if no valid IPv4 portal IP
		if p.portalIP == nil || p.portalIP.To4() == nil {
			p.logger.Warn("DNS listener disabled: no valid IPv4 portal IP")
			return
		}

		buf := make([]byte, 512) // F44: reads ≤512 bytes
		for {
			select {
			case <-ctx.Done():
				return
			default:
			}

			conn.SetReadDeadline(time.Now().Add(1 * time.Second))
			n, remoteAddr, err := conn.ReadFromUDP(buf)
			if err != nil {
				if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
					continue
				}
				p.logger.Error("DNS read error", "err", err)
				return
			}

			// Wrap per-packet handling in recover (fail-safe: one bad packet doesn't stop listener)
			func() {
				defer func() {
					if r := recover(); r != nil {
						p.logger.Warn("DNS packet panic", "err", r)
					}
				}()

				// F44: Drop if sport 53, response, opcode ≠ 0, qdcount ≠ 1, or unparsable
				if remoteAddr.Port == 53 {
					return
				}

				var msg dnsmessage.Message
				if err := msg.Unpack(buf[:n]); err != nil {
					return
				}

				// Drop if response or invalid opcode or wrong question count
				if msg.Response || msg.OpCode != 0 || len(msg.Questions) != 1 {
					return
				}

				// Handle query
				q := msg.Questions[0]
				resp := p.buildDNSResponse(&msg, q)

				// Send response
				packed, err := resp.Pack()
				if err != nil {
					p.logger.Error("DNS pack error", "err", err)
					return
				}

				if _, err := conn.WriteToUDP(packed, remoteAddr); err != nil {
					p.logger.Error("DNS write error", "err", err)
				}
			}()
		}
	}()

	return nil
}

// buildDNSResponse creates a DNS response (F44: A -> box IP, other types -> NOERROR, no answer)
func (p *Portal) buildDNSResponse(req *dnsmessage.Message, q dnsmessage.Question) *dnsmessage.Message {
	resp := dnsmessage.Message{}
	resp.ID = req.ID
	resp.Response = true
	resp.Authoritative = true
	resp.RecursionAvailable = true
	resp.RecursionDesired = req.RecursionDesired
	resp.RCode = dnsmessage.RCodeSuccess
	resp.Questions = []dnsmessage.Question{q}

	// F44: A -> box IP, TTL 30, aa=1, ra=1, rd copied; other types -> NOERROR, no answer
	if q.Type == dnsmessage.TypeA && p.portalIP != nil {
		v4 := p.portalIP.To4()
		if v4 == nil {
			return &resp // No answer for IPv6-only portal IP
		}
		arec := dnsmessage.AResource{
			A: [4]byte{v4[0], v4[1], v4[2], v4[3]},
		}
		resp.Answers = []dnsmessage.Resource{
			{
				Header: dnsmessage.ResourceHeader{
					Name:  q.Name,
					Type:  dnsmessage.TypeA,
					Class: dnsmessage.ClassINET,
					TTL:   30,
				},
				Body: &arec,
			},
		}
	}

	return &resp
}

// ListenHTTP starts the HTTP listener on :80 (F45)
func (p *Portal) ListenHTTP(ctx context.Context) error {
	mux := http.NewServeMux()
	mux.HandleFunc("/", p.handleHTTPRedirect)

	p.httpSrv = &http.Server{
		Addr:         p.httpAddr,
		Handler:      mux,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 5 * time.Second,
	}

	go func() {
		defer func() {
			if r := recover(); r != nil {
				p.logger.Error("HTTP listener panic", "err", r)
			}
		}()

		if err := p.httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			p.logger.Error("HTTP listen error", "err", err)
		}
	}()

	go func() {
		<-ctx.Done()
		p.httpSrv.Close()
	}()

	return nil
}

// handleHTTPRedirect handles all HTTP methods with 302 redirect (F45)
func (p *Portal) handleHTTPRedirect(w http.ResponseWriter, r *http.Request) {
	// F46: Record hit - client IP -> MAC via enforced IP->MAC map
	clientIP := r.RemoteAddr
	if host, _, err := net.SplitHostPort(clientIP); err == nil {
		clientIP = host
	}
	if mac, exists := p.ipToMACMap[clientIP]; exists {
		if p.hitsFunc != nil {
			_ = p.hitsFunc(mac)
		}
	}

	// F45: Every method -> 302 Location: PORTAL_REDIRECT_URL, Content-Length: 0
	w.Header().Set("Location", p.portalRedirectURL)
	w.Header().Set("Content-Length", "0")
	w.WriteHeader(http.StatusFound)
}

// SetHitsFunc sets the hit recording callback
func (p *Portal) SetHitsFunc(fn func(mac string) error) {
	p.hitsFunc = fn
}

// Shutdown gracefully stops portal services
func (p *Portal) Shutdown(ctx context.Context) error {
	if p.httpSrv != nil {
		return p.httpSrv.Shutdown(ctx)
	}
	return nil
}
