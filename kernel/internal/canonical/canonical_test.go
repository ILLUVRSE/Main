package canonical_test

import (
	"encoding/json"
	"testing"

	"github.com/ILLUVRSE/Main/kernel/internal/canonical"
)

func TestCanonicalSortedKeys(t *testing.T) {
	a := map[string]interface{}{
		"b": 2,
		"a": 1,
	}
	b := map[string]interface{}{
		"a": 1,
		"b": 2,
	}

	ca, err := canonical.MarshalCanonical(a)
	if err != nil {
		t.Fatalf("canonical.MarshalCanonical(a) error: %v", err)
	}
	cb, err := canonical.MarshalCanonical(b)
	if err != nil {
		t.Fatalf("canonical.MarshalCanonical(b) error: %v", err)
	}

	if string(ca) != string(cb) {
		t.Fatalf("canonical outputs differ:\nA: %s\nB: %s", ca, cb)
	}

	// Ensure JSON is valid
	var tmp interface{}
	if err := json.Unmarshal(ca, &tmp); err != nil {
		t.Fatalf("canonical output is not valid JSON: %v", err)
	}
}

func TestCanonicalNumbersAndArrays(t *testing.T) {
	in := map[string]interface{}{
		"list": []interface{}{3, 2, 1},
		"num":  json.Number("123.45"),
		"str":  "hello",
		"bool": true,
		"nil":  nil,
	}

	c, err := canonical.MarshalCanonical(in)
	if err != nil {
		t.Fatalf("canonical.MarshalCanonical error: %v", err)
	}

	// check it unmarshals back to a map and preserves fields
	var out map[string]interface{}
	if err := json.Unmarshal(c, &out); err != nil {
		t.Fatalf("unmarshal canonical: %v", err)
	}

	// basic checks
	if out["str"] != "hello" {
		t.Fatalf("expected str 'hello', got %#v", out["str"])
	}
	if out["bool"] != true {
		t.Fatalf("expected bool true, got %#v", out["bool"])
	}
	if out["nil"] != nil {
		// JSON unmarshals null to nil interface{}, test using reflect or comparison
		if out["nil"] != nil {
			t.Fatalf("expected nil, got %#v", out["nil"])
		}
	}
}

