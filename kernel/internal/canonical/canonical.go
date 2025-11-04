package canonical

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
)

// MarshalCanonical returns deterministic JSON bytes for an arbitrary JSON-like value.
// Rules:
// - Objects (map[string]interface{}): keys sorted lexicographically.
// - Arrays: order preserved.
// - Numbers/strings/booleans/null: encoded consistently using encoding/json for primitives where appropriate.
func MarshalCanonical(v interface{}) ([]byte, error) {
	var buf bytes.Buffer
	if err := encode(&buf, v); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func encode(buf *bytes.Buffer, v interface{}) error {
	switch vv := v.(type) {
	case nil:
		buf.WriteString("null")
	case bool:
		if vv {
			buf.WriteString("true")
		} else {
			buf.WriteString("false")
		}
	case json.Number:
		// Preserve textual representation (useful to keep determinism for numbers)
		buf.WriteString(vv.String())
	case float64:
		// Fallback for numeric values unmarshaled without UseNumber.
		b, _ := json.Marshal(vv)
		buf.Write(b)
	case string:
		b, _ := json.Marshal(vv)
		buf.Write(b)
	case []interface{}:
		buf.WriteByte('[')
		for i, elem := range vv {
			if i > 0 {
				buf.WriteByte(',')
			}
			if err := encode(buf, elem); err != nil {
				return err
			}
		}
		buf.WriteByte(']')
	case map[string]interface{}:
		// Sort keys for deterministic ordering
		keys := make([]string, 0, len(vv))
		for k := range vv {
			keys = append(keys, k)
		}
		sort.Strings(keys)

		buf.WriteByte('{')
		for i, k := range keys {
			if i > 0 {
				buf.WriteByte(',')
			}
			// key as JSON string
			kb, _ := json.Marshal(k)
			buf.Write(kb)
			buf.WriteByte(':')
			if err := encode(buf, vv[k]); err != nil {
				return err
			}
		}
		buf.WriteByte('}')
	default:
		// Fallback: marshal then re-decode into interface{} with UseNumber and encode recursively.
		b, err := json.Marshal(vv)
		if err != nil {
			return fmt.Errorf("canonical marshal fallback: %w", err)
		}
		var tmp interface{}
		dec := json.NewDecoder(bytes.NewReader(b))
		dec.UseNumber()
		if err := dec.Decode(&tmp); err != nil {
			return fmt.Errorf("canonical decode fallback: %w", err)
		}
		return encode(buf, tmp)
	}
	return nil
}

