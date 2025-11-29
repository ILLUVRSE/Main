
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Define the Kernel canonicalization logic (re-implemented or imported)
function kernelCanonicalize(obj) {
    const normalize = (value) => {
        if (value === null || typeof value !== 'object') return value;
        if (Array.isArray(value)) return value.map(normalize);
        const out = {};
        for (const key of Object.keys(value).sort()) {
            out[key] = normalize(value[key]);
        }
        return out;
    };
    return JSON.stringify(normalize(obj));
}

// We need a way to invoke the Go canonicalization.
// I will build a small CLI tool for this purpose if one doesn't exist.
// Or I can write a Go test that outputs to a file and this test reads it.
// Or `execSync('go run ...')`.

describe('Node Canonical Parity', () => {
    const testCases = [
        { name: 'Simple Object', input: { c: 1, a: 2, b: 3 } },
        { name: 'Nested Object', input: { z: { c: 1, a: 2 }, y: [3, 2, 1] } },
        { name: 'Arrays', input: { list: [ { b: 2, a: 1 }, 10, "foo" ] } },
        { name: 'Unicode', input: { text: "Hello 世界", emoji: "👋" } },
        { name: 'Empty', input: {} },
        { name: 'Nulls', input: { a: null, b: "value" } },
        { name: 'HTML Chars', input: { html: "<script>alert(1)</script>", ampersand: "&" } }
    ];

    test.each(testCases)('$name matches Kernel rules', ({ input }) => {
        const expected = kernelCanonicalize(input);

        // Invoke Go canonicalization
        // We can pass input as JSON string argument
        const inputJson = JSON.stringify(input);

        // We'll rely on a small Go main program created for this test.
        // Let's assume we create `reasoning-graph/cmd/canonicalize_tool/main.go`

        // Write input to temp file to avoid shell escaping issues
        const tmpInput = path.join(__dirname, `temp_input_${Date.now()}.json`);
        fs.writeFileSync(tmpInput, inputJson);

        try {
            // Using `go run` might be slow for individual tests, but acceptable for this task.
            // Better: build it once before tests. But `runInBand` makes it okay.
            const stdout = execSync(`go run ./cmd/canonicalize_tool/main.go ${tmpInput}`, {
                cwd: path.resolve(__dirname, '..')
            });

            const actual = stdout.toString(); // Go tool should output raw bytes without newline if possible, or we trim.
            // My Go implementation removes trailing newline.

            expect(actual).toBe(expected);
        } finally {
            if (fs.existsSync(tmpInput)) fs.unlinkSync(tmpInput);
        }
    });
});
