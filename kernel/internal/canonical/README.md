# canonical — deterministic JSON canonicalization

This package implements `MarshalCanonical(v interface{}) ([]byte, error)` which
returns deterministic JSON bytes for arbitrary JSON-like values.

## Rules / behavior

* Objects (map[string]interface{}): keys are sorted lexicographically (ascending).
* Arrays: order is preserved.
* Numbers: encoded consistently; the Go implementation uses `encoding/json` with
  `UseNumber()` to preserve numeric textual representation where appropriate.
* Strings / booleans / null: encoded using `encoding/json` for primitives.
* The implementation intentionally avoids whitespace and uses minimal JSON
  (no pretty-printing) so results are compact and deterministic.

The canonical bytes produced here are the authoritative source for verification
and signing. Any other runtime (Node, Python, etc.) that must interoperate with
Kernel should produce *byte-for-byte* identical canonical output for the same
logical JSON value.

## Test vectors

To make parity tests reproducible, the Node parity test and other test
harnesses share canonical vectors at:

```
kernel/test/vectors/canonical_vectors.json
```

This file contains an array of named test vectors (`vectors`) that the Node test
loads and feeds to the Go helper; the Go helper calls `MarshalCanonical()` and
returns the canonical bytes for comparison.

### How to add a vector

1. Edit `kernel/test/vectors/canonical_vectors.json`.
2. Add an object with shape `{ "name": "<short name>", "value": <json value> }`.
   Example:

   ```json
   {
     "name": "new-case",
     "value": { "z": [2, 1], "a": 1 }
   }
   ```
3. Run the Node ↔ Go parity test locally:

   ```bash
   # from repo root
   npx jest kernel/test/node_canonical_parity.test.js --runInBand
   ```

   If `go` is installed the test will run and compare byte-for-byte equality.
   If `go` is not available, the test will be skipped.

## Debugging parity failures

If a vector fails parity, check:

* Numeric encoding differences (use `UseNumber()` in Go; ensure Node doesn't
  coerce numbers unexpectedly).
* Object key ordering — both runtimes must sort keys lexicographically.
* String escaping differences — ensure both sides use standard JSON escaping.
* Array ordering and nested structures.

A recommended approach when debugging:

1. Print the canonical bytes from Go (base64) and from Node and diff them as
   bytes or hex strings to locate the first differing byte.
2. Narrow down the difference by simplifying the test vector (remove fields
   until parity is achieved).
3. Fix the implementation or the vector encoding accordingly.

## Implementation note

`MarshalCanonical` is intentionally small and conservative. It favors an
implementation that is easy to reason about over extreme optimization. The
consumer-facing guarantee is deterministic, stable bytes for identical logical
values.

If you discover a parity bug, add a unit test and a small code fix; don't
assume the vector is wrong.

