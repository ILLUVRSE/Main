package tlsutil

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"os"
	"time"
)

// NewTLSConfigFromFiles builds a tls.Config from on-disk PEM files.
//
// - serverCertFile/serverKeyFile: server certificate and private key (PEM).
// - clientCAFile: optional CA bundle (PEM) used to verify client certificates for mTLS.
// - requireClientCert: if true, ClientAuth is set to RequireAndVerifyClientCert; otherwise
//   ClientAuth is VerifyClientCertIfGiven (accepts client certs if presented).
//
// Returns a configured *tls.Config. Caller may set additional fields (GetCertificate, etc.).
func NewTLSConfigFromFiles(serverCertFile, serverKeyFile, clientCAFile string, requireClientCert bool) (*tls.Config, error) {
	if serverCertFile == "" || serverKeyFile == "" {
		return nil, fmt.Errorf("server cert and key files must be provided")
	}

	cert, err := tls.LoadX509KeyPair(serverCertFile, serverKeyFile)
	if err != nil {
		return nil, fmt.Errorf("load server cert/key: %w", err)
	}

	tlsCfg := &tls.Config{
		Certificates: []tls.Certificate{cert},
		MinVersion:   tls.VersionTLS12,
		// prefer server cipher suites for consistent behavior
		PreferServerCipherSuites: true,
	}

	// Client cert handling (optional)
	if clientCAFile != "" {
		caPEM, err := os.ReadFile(clientCAFile)
		if err != nil {
			return nil, fmt.Errorf("read client CA file: %w", err)
		}
		certPool := x509.NewCertPool()
		if !certPool.AppendCertsFromPEM(caPEM) {
			return nil, fmt.Errorf("failed to parse client CA bundle")
		}
		tlsCfg.ClientCAs = certPool
		if requireClientCert {
			tlsCfg.ClientAuth = tls.RequireAndVerifyClientCert
		} else {
			// accept client certs if presented, but don't require them
			tlsCfg.ClientAuth = tls.VerifyClientCertIfGiven
		}
	} else {
		// no client CA provided
		if requireClientCert {
			return nil, fmt.Errorf("requireClientCert=true but client CA file not provided")
		}
		// no client certs expected
		tlsCfg.ClientAuth = tls.NoClientCert
	}

	// Reasonable defaults for server side: keep connections alive and prefer modern ciphers.
	tlsCfg.Renegotiation = tls.RenegotiateNever
	tlsCfg.SessionTicketsDisabled = false
	tlsCfg.MinVersion = tls.VersionTLS12
	tlsCfg.Time = time.Now

	return tlsCfg, nil
}

