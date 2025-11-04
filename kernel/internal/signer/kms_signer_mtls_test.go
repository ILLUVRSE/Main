package signer_test

import (
	"bytes"
	"crypto/ed25519"
	crand "crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	signerpkg "github.com/ILLUVRSE/Main/kernel/internal/signer"
)

func writePEMFile(t *testing.T, dir, name string, b []byte) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, b, 0o600); err != nil {
		t.Fatalf("write PEM %s: %v", path, err)
	}
	return path
}

func genRSAKey(t *testing.T) *rsa.PrivateKey {
	t.Helper()
	k, err := rsa.GenerateKey(crand.Reader, 2048)
	if err != nil {
		t.Fatalf("rsa.GenerateKey: %v", err)
	}
	return k
}

func pemEncodeCert(der []byte) []byte {
	buf := &bytes.Buffer{}
	_ = pem.Encode(buf, &pem.Block{Type: "CERTIFICATE", Bytes: der})
	return buf.Bytes()
}

func pemEncodePrivateKeyRSA(key *rsa.PrivateKey) []byte {
	buf := &bytes.Buffer{}
	_ = pem.Encode(buf, &pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})
	return buf.Bytes()
}

func TestKMSSignerSign_mTLS(t *testing.T) {
	tmp := t.TempDir()

	// 1) Create CA (RSA)
	caKey := genRSAKey(t)
	caTmpl := &x509.Certificate{
		SerialNumber: big.NewInt(2025),
		Subject:      pkix.Name{CommonName: "test-ca"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(24 * time.Hour),
		KeyUsage:     x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		IsCA:         true,
		BasicConstraintsValid: true,
	}
	caDER, err := x509.CreateCertificate(crand.Reader, caTmpl, caTmpl, &caKey.PublicKey, caKey)
	if err != nil {
		t.Fatalf("create CA cert: %v", err)
	}
	caPEM := pemEncodeCert(caDER)
	writePEMFile(t, tmp, "ca.pem", caPEM)

	// 2) Server cert (RSA) signed by CA, include 127.0.0.1
	serverKey := genRSAKey(t)
	serverTmpl := &x509.Certificate{
		SerialNumber: big.NewInt(1001),
		Subject:      pkix.Name{CommonName: "localhost"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
	}
	serverDER, err := x509.CreateCertificate(crand.Reader, serverTmpl, caTmpl, &serverKey.PublicKey, caKey)
	if err != nil {
		t.Fatalf("create server cert: %v", err)
	}
	serverCertPEM := pemEncodeCert(serverDER)
	serverKeyPEM := pemEncodePrivateKeyRSA(serverKey)
	_ = writePEMFile(t, tmp, "server.pem", serverCertPEM)
	_ = writePEMFile(t, tmp, "server.key", serverKeyPEM)

	// 3) Client cert (RSA) signed by CA for client auth
	clientKey := genRSAKey(t)
	clientTmpl := &x509.Certificate{
		SerialNumber: big.NewInt(2002),
		Subject:      pkix.Name{CommonName: "test-client"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
	}
	clientDER, err := x509.CreateCertificate(crand.Reader, clientTmpl, caTmpl, &clientKey.PublicKey, caKey)
	if err != nil {
		t.Fatalf("create client cert: %v", err)
	}
	clientCertPEM := pemEncodeCert(clientDER)
	clientKeyPEM := pemEncodePrivateKeyRSA(clientKey)
	clientCertPath := writePEMFile(t, tmp, "client.pem", clientCertPEM)
	clientKeyPath := writePEMFile(t, tmp, "client.key", clientKeyPEM)

	// 4) Prepare server TLS certificate (load into tls.Certificate)
	serverTLSCert, err := tls.X509KeyPair(append(serverCertPEM, caPEM...), serverKeyPEM)
	if err != nil {
		t.Fatalf("tls.X509KeyPair server: %v", err)
	}

	// 5) Create an ed25519 keypair for signing responses (separate from TLS keys)
	signPub, signPriv, _ := ed25519.GenerateKey(crand.Reader)

	// 6) Create httptest server with RequireAndVerifyClientCert
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// ensure client presented certificate
		if r.TLS == nil || len(r.TLS.PeerCertificates) == 0 {
			http.Error(w, "client cert required", http.StatusUnauthorized)
			return
		}
		if r.Method != http.MethodPost || r.URL.Path != "/signData" {
			http.NotFound(w, r)
			return
		}
		var req struct {
			SignerId string `json:"signerId"`
			Data     string `json:"data"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		data, err := base64.StdEncoding.DecodeString(req.Data)
		if err != nil {
			http.Error(w, "bad base64", http.StatusBadRequest)
			return
		}
		sig := ed25519.Sign(signPriv, data)
		_ = json.NewEncoder(w).Encode(map[string]string{
			"signature": base64.StdEncoding.EncodeToString(sig),
			"signerId":  req.SignerId,
		})
	})

	ts := httptest.NewUnstartedServer(handler)
	ts.TLS = &tls.Config{
		Certificates: []tls.Certificate{serverTLSCert},
		ClientAuth:   tls.RequireAndVerifyClientCert,
	}
	// provide CA pool for server to verify client cert
	cp := x509.NewCertPool()
	if !cp.AppendCertsFromPEM(caPEM) {
		t.Fatalf("failed to append CA PEM")
	}
	ts.TLS.ClientCAs = cp
	ts.StartTLS()
	defer ts.Close()

	// write CA bundle to file
	caPath := writePEMFile(t, tmp, "ca_bundle.pem", caPEM)

	// set envs for NewKMSSigner to pick up client cert/key and CA bundle
	os.Setenv("KMS_MTLS_CERT_PATH", clientCertPath)
	defer os.Unsetenv("KMS_MTLS_CERT_PATH")
	os.Setenv("KMS_MTLS_KEY_PATH", clientKeyPath)
	defer os.Unsetenv("KMS_MTLS_KEY_PATH")
	os.Setenv("KMS_MTLS_CA_PATH", caPath)
	defer os.Unsetenv("KMS_MTLS_CA_PATH")
	os.Setenv("SIGNER_ID", "mtls-test-signer")
	defer os.Unsetenv("SIGNER_ID")

	// Create signer pointing at test server
	ks, err := signerpkg.NewKMSSigner(ts.URL, false)
	if err != nil {
		t.Fatalf("NewKMSSigner err: %v", err)
	}
	if ks == nil {
		t.Fatalf("expected kms signer, got nil")
	}

	data := []byte("mtls-hash")
	sig, sid, err := ks.Sign(data)
	if err != nil {
		t.Fatalf("Sign error: %v", err)
	}
	if sid != "mtls-test-signer" {
		t.Fatalf("unexpected signerId: %s", sid)
	}
	if !ed25519.Verify(signPub, data, sig) {
		t.Fatalf("signature verification failed (mtls)")
	}
}

