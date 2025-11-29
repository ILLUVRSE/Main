
const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

describe('Integration: Snapshot Signing', () => {
    // This test simulates the full flow:
    // 1. Generate snapshot via Go service (invoked via a test tool/main wrapper).
    // 2. Verify snapshot via TS tool.

    // Since we don't have the full service running with HTTP endpoints here easily without setup,
    // we will create a Go CLI wrapper that invokes CreateSnapshotAndSign.

    const fixturesDir = path.resolve(__dirname, '../fixtures');
    const signersPath = path.join(fixturesDir, 'signers.json');
    const outputDir = path.join(fixturesDir, 'snapshots');

    beforeAll(() => {
        if (!fs.existsSync(fixturesDir)) fs.mkdirSync(fixturesDir, { recursive: true });
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    });

    test('Create and Verify Snapshot', () => {
        const snapshotFile = path.join(outputDir, `snap_${Date.now()}.json`);

        // 1. Run Go tool to create snapshot
        // We need a CLI entrypoint for CreateSnapshotAndSign.
        // I'll create `reasoning-graph/cmd/test_snapshot_tool/main.go`
        const cmd = `go run ./cmd/test_snapshot_tool/main.go -out ${snapshotFile} -signers ${signersPath}`;

        try {
            execSync(cmd, { cwd: path.resolve(__dirname, '../..') });
        } catch (e) {
            console.error(e.stdout?.toString());
            console.error(e.stderr?.toString());
            throw e;
        }

        expect(fs.existsSync(snapshotFile)).toBe(true);

        // 2. Verify using the TS tool
        // Compile verify tool if necessary or run with ts-node
        const verifyCmd = `npx ts-node tools/verify_snapshot.ts ${snapshotFile} ${signersPath}`;
        try {
            execSync(verifyCmd, { cwd: path.resolve(__dirname, '../..') });
        } catch (e) {
            console.error("Verification failed:", e.stdout?.toString(), e.stderr?.toString());
            throw e;
        }
    });

    test('Verification fails on tampered data', () => {
        const snapshotFile = path.join(outputDir, `snap_tampered_${Date.now()}.json`);

        // 1. Create snapshot
        const cmd = `go run ./cmd/test_snapshot_tool/main.go -out ${snapshotFile} -signers ${signersPath}`;
        execSync(cmd, { cwd: path.resolve(__dirname, '../..') });

        // 2. Tamper with it
        const content = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
        content.payload.nodes = ["tampered"]; // Change payload
        // Hash and signature will now mismatch the payload
        fs.writeFileSync(snapshotFile, JSON.stringify(content));

        // 3. Verify should fail
        const verifyCmd = `npx ts-node tools/verify_snapshot.ts ${snapshotFile} ${signersPath}`;
        expect(() => {
            execSync(verifyCmd, { cwd: path.resolve(__dirname, '../..'), stdio: 'pipe' });
        }).toThrow();
    });
});
