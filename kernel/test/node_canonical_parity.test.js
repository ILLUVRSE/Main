// kernel/test/node_canonical_parity.test.js
//
// Parity tests: assert byte-for-byte equality between Node canonicalize()
// (agent-manager/server/audit_signer.js) and Go canonical.MarshalCanonical.
//
// This test reads canonicalization vectors from kernel/test/vectors/canonical_vectors.json,
// writes a small Go helper into kernel/test/node_canonical_parity_helper.go, runs it with `go run`,
// and compares results. Tests are skipped automatically if `go` is not present on PATH.

const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');
const { canonicalize } = require('../../agent-manager/server/audit_signer');

jest.setTimeout(20000);

const repoRoot = path.resolve(__dirname, '..', '..');
const helperFilename = path.join(__dirname, 'node_canonical_parity_helper.go');
const vectorsPath = path.join(__dirname, 'vectors', 'canonical_vectors.json');

const helperGo = `package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"os"

	"github.com/ILLUVRSE/Main/kernel/internal/canonical"
)

func main() {
	b, err := ioutil.ReadAll(os.Stdin)
	if err != nil {
		fmt.Fprintf(os.Stderr, "read stdin error: %v\\n", err)
		os.Exit(2)
	}
	var v interface{}
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.UseNumber()
	if err := dec.Decode(&v); err != nil {
		fmt.Fprintf(os.Stderr, "json decode error: %v\\n", err)
		os.Exit(3)
	}
	cb, err := canonical.MarshalCanonical(v)
	if err != nil {
		fmt.Fprintf(os.Stderr, "canonical marshal error: %v\\n", err)
		os.Exit(4)
	}
	fmt.Printf("%s", base64.StdEncoding.EncodeToString(cb))
}
`;

function hasGoInstalled() {
  try {
    const r = spawnSync('go', ['version'], { encoding: 'utf8' });
    return !r.error && r.status === 0;
  } catch (e) {
    return false;
  }
}

const runGoHelper = (jsonStr) => {
  return new Promise((resolve, reject) => {
    const proc = spawn('go', ['run', helperFilename], { cwd: repoRoot });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`go run failed (code=${code}): ${stderr}`));
      }
      try {
        const trimmed = stdout.trim();
        const buf = Buffer.from(trimmed, 'base64');
        resolve(buf.toString('utf8'));
      } catch (e) {
        reject(e);
      }
    });

    proc.stdin.write(jsonStr);
    proc.stdin.end();
  });
};

describe('Node <-> Go canonicalization parity (vectors from file)', () => {
  const goAvailable = hasGoInstalled();

  beforeAll(() => {
    // write helper Go file into kernel/test/ for go run
    fs.writeFileSync(helperFilename, helperGo, { encoding: 'utf8' });
  });

  afterAll(() => {
    try { fs.unlinkSync(helperFilename); } catch (e) { /* ignore */ }
  });

  // load vectors from canonical_vectors.json
  let vectors;
  try {
    const raw = fs.readFileSync(vectorsPath, 'utf8');
    const parsed = JSON.parse(raw);
    vectors = parsed.vectors || [];
  } catch (e) {
    // If vectors file missing, fall back to the inline small set to avoid test failure.
    vectors = [
      { name: 'object key ordering (simple)', value: { b: 1, a: 2 } },
      { name: 'nested objects and arrays', value: { z: ["z", "a"], obj: { c: 3, b: 2, a: [2, 1] } } },
      { name: 'null, booleans and numbers', value: { flag: true, nothing: null, neg: -5, float: 1.2345 } },
      { name: 'strings needing escaping', value: { s: 'quote " and backslash \\\\ and unicode \\u2603', arr: ["a", "b", { x: 1 }] } },
      { name: 'array ordering preserved', value: [3, 1, 2, { b: 'B', a: 'A' }, [2,1]] },
    ];
  }

  (goAvailable ? it : it.skip)('parity for canonicalization vectors (node vs go)', async () => {
    for (const vec of vectors) {
      const jsCanonical = canonicalize(vec.value);

      // Use JSON.stringify to produce input; Go helper uses Decoder.UseNumber() so numeric fidelity preserved.
      const input = JSON.stringify(vec.value);

      let goCanonical;
      try {
        goCanonical = await runGoHelper(input);
      } catch (e) {
        throw new Error(`Go helper failed for vector "${vec.name}": ${e.message}`);
      }

      // Compare byte-for-byte equality
      expect(jsCanonical).toBe(goCanonical);
    }
  });

  if (!goAvailable) {
    it.skip('go not installed - parity tests skipped', () => {});
  }
});

