package signing

import (
	"time"

	"github.com/ILLUVRSE/Main/ai-infra/internal/config"
)

func NewSignerFromConfig(cfg config.Config) (Signer, error) {
	if cfg.KMSEndpoint != "" {
		return NewKMSSigner(KMSSignerConfig{
			Endpoint: cfg.KMSEndpoint,
			Timeout:  5 * time.Second,
			Retries:  2,
		})
	}
	return NewEd25519SignerFromB64(cfg.SignerKeyB64, cfg.SignerID)
}
