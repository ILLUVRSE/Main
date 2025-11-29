package canonical

import (
	"encoding/json"
)

// Canonicalize returns the canonical JSON representation of the input object.
// It follows the Kernel rules:
// - Object keys are sorted lexicographically (guaranteed by Go's encoding/json for maps).
// - Arrays are preserved (order is significant).
// - No HTML escaping.
func Canonicalize(v interface{}) ([]byte, error) {
	// Step 1: Round-trip to interface{} to convert structs to maps.
	// This ensures fields are accessible as map keys for sorting by the json encoder.
	// It also normalizes types.
	b, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}

	var generic interface{}
	if err := json.Unmarshal(b, &generic); err != nil {
		return nil, err
	}

	// Step 2: Encode with SetEscapeHTML(false)
	buffer := &bytesBuffer{}
	encoder := json.NewEncoder(buffer)
	encoder.SetEscapeHTML(false)

	// Note: json.NewEncoder(buffer).Encode(generic) will sort map keys.
	if err := encoder.Encode(generic); err != nil {
		return nil, err
	}

	// Step 3: Remove trailing newline added by Encoder
	bytes := buffer.Bytes()
	if len(bytes) > 0 && bytes[len(bytes)-1] == '\n' {
		bytes = bytes[:len(bytes)-1]
	}

	return bytes, nil
}

// Simple buffer wrapper to avoid bytes.Buffer import if we want to keep imports minimal.
type bytesBuffer struct {
	data []byte
}

func (b *bytesBuffer) Write(p []byte) (n int, err error) {
	b.data = append(b.data, p...)
	return len(p), nil
}

func (b *bytesBuffer) Bytes() []byte {
	return b.data
}
