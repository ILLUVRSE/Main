package signing

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"testing"
	"time"
)

func TestKMSSignerSign(t *testing.T) {
	transport := roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path != "/sign" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		defer r.Body.Close()
		var payload struct {
			PayloadB64 string `json:"payload_b64"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		sig := append([]byte("signed:"), payload.PayloadB64...)
		resp := map[string]string{
			"signature_b64": base64.StdEncoding.EncodeToString(sig),
			"signer_id":     "kms-key-1",
		}
		body, _ := json.Marshal(resp)
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(bytes.NewReader(body)),
			Header:     make(http.Header),
		}, nil
	})

	signer, err := NewKMSSigner(KMSSignerConfig{
		Endpoint:   "http://kms",
		Timeout:    time.Second,
		Retries:    1,
		HTTPClient: &http.Client{Transport: transport},
	})
	if err != nil {
		t.Fatalf("new kms signer: %v", err)
	}

	payload := []byte("model-manifest")
	sig, err := signer.Sign(context.Background(), payload)
	if err != nil {
		t.Fatalf("kms sign: %v", err)
	}
	expected := append([]byte("signed:"), base64.StdEncoding.EncodeToString(payload)...)
	if string(sig) != string(expected) {
		t.Fatalf("unexpected signature %q", string(sig))
	}
	if signer.SignerID() != "kms-key-1" {
		t.Fatalf("unexpected signer id %s", signer.SignerID())
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}
