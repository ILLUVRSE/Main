"use strict";
/**
 * memory-layer/service/audit/verificationCliWrapper.ts
 *
 * Utility CLI to verify archived audit exports and optionally replay them into a DB
 * and run the audit verification tool.
 *
 * Usage examples:
 *
 *  # Verify an archive in S3 by computing sha256:
 *  AUDIT_ARCHIVE_BUCKET=... npx ts-node memory-layer/service/audit/verificationCliWrapper.ts --from-s3=s3://bucket/key.json
 *
 *  # Verify archive against manifest and then replay into DB and run verifyTool:
 *  DATABASE_URL=... npx ts-node memory-layer/service/audit/verificationCliWrapper.ts \
 *    --from-file=./export.json --compare-manifest=./export.json.manifest.json --replay --verify-db
 *
 *  # Replay and verify via auditReplay + verifyTool (force)
 *  DATABASE_URL=... npx ts-node memory-layer/service/audit/verificationCliWrapper.ts \
 *    --from-file=./export.json --replay --verify-db --force
 *
 * Behavior:
 *  - Downloads S3 object or reads local file, computes SHA-256 and reports it.
 *  - If compare-manifest provided, verifies manifest.sha256 matches computed digest.
 *  - If --replay provided, writes file to a temporary path and invokes auditReplay CLI to insert into DB.
 *  - If --verify-db provided, runs audit verify tool CLI to validate chain/signatures in DB.
 *
 * Notes:
 *  - This wrapper shells out to the existing auditReplay & verifyTool CLIs to reuse logic.
 *  - Designed for CI validation and operator sanity checks.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_s3_1 = require("@aws-sdk/client-s3");
const stream_1 = require("stream");
const node_crypto_1 = __importDefault(require("node:crypto"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const uuid_1 = require("uuid");
const child_process_1 = __importDefault(require("child_process"));
function parseArg(name) {
    const prefix = `--${name}=`;
    return process.argv.slice(2).find((a) => a.startsWith(prefix))?.slice(prefix.length);
}
function hasFlag(name) {
    return process.argv.slice(2).some((a) => a === `--${name}`);
}
async function streamToBuffer(stream) {
    if (!stream)
        return Buffer.alloc(0);
    return new Promise((resolve, reject) => {
        const chunks = [];
        stream.on('data', (chunk) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', (err) => reject(err));
    });
}
async function fetchS3Object(s3url) {
    if (!s3url.startsWith('s3://'))
        throw new Error('from-s3 must be s3://bucket/key');
    const without = s3url.slice('s3://'.length);
    const slash = without.indexOf('/');
    if (slash <= 0)
        throw new Error('invalid s3 url (expected s3://bucket/key)');
    const bucket = without.slice(0, slash);
    const key = without.slice(slash + 1);
    const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
    const client = new client_s3_1.S3Client({ region });
    const cmd = new client_s3_1.GetObjectCommand({ Bucket: bucket, Key: key });
    const resp = await client.send(cmd);
    const body = resp.Body;
    if (!body)
        throw new Error('S3 returned empty body');
    // If body is web ReadableStream, convert - but in Node environment it should be Node Readable
    if (body.pipe && typeof body.pipe === 'function') {
        return streamToBuffer(body);
    }
    if (typeof body.getReader === 'function') {
        // Convert web stream to node stream
        const reader = body.getReader();
        const nodeStream = stream_1.Readable.from((async function* () {
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done)
                        break;
                    yield Buffer.from(value);
                }
            }
            finally {
                if (reader.releaseLock)
                    reader.releaseLock();
            }
        })());
        return streamToBuffer(nodeStream);
    }
    throw new Error('Unsupported S3 body stream type');
}
function computeSha256Hex(buf) {
    return node_crypto_1.default.createHash('sha256').update(Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf), 'utf8')).digest('hex');
}
async function writeTempFile(prefix = 'audit-export-', ext = '.json', content) {
    const filename = `${prefix}${(0, uuid_1.v4)()}${ext}`;
    const tmpdir = process.env.TMPDIR || os_1.default.tmpdir();
    const full = path_1.default.join(tmpdir, filename);
    await fs_1.default.promises.writeFile(full, content);
    return full;
}
function runCommandSync(cmd, args, env) {
    console.log(`> ${cmd} ${args.join(' ')}`);
    try {
        const res = child_process_1.default.spawnSync(cmd, args, {
            stdio: 'inherit',
            env: { ...process.env, ...(env ?? {}) },
            shell: false
        });
        if (res.error) {
            throw res.error;
        }
        return res.status ?? 0;
    }
    catch (err) {
        throw err;
    }
}
async function main() {
    const fromS3 = parseArg('from-s3');
    const fromFile = parseArg('from-file');
    if (!fromS3 && !fromFile) {
        console.error('Specify --from-s3 or --from-file');
        process.exit(2);
    }
    if (fromS3 && fromFile) {
        console.error('Specify only one of --from-s3 or --from-file');
        process.exit(2);
    }
    const compareManifest = parseArg('compare-manifest'); // local manifest path
    const replay = hasFlag('replay');
    const verifyDb = hasFlag('verify-db');
    const force = hasFlag('force') || false;
    const dryRun = hasFlag('dry-run');
    let buf;
    if (fromS3) {
        console.log(`Fetching from S3: ${fromS3}`);
        buf = await fetchS3Object(fromS3);
    }
    else {
        const p = path_1.default.resolve(String(fromFile));
        console.log(`Reading from file: ${p}`);
        buf = await fs_1.default.promises.readFile(p);
    }
    const sha256 = computeSha256Hex(buf);
    console.log(`Computed SHA-256: ${sha256}`);
    console.log(`Size bytes: ${buf.length}`);
    if (compareManifest) {
        const manifestPath = path_1.default.resolve(String(compareManifest));
        if (!fs_1.default.existsSync(manifestPath)) {
            console.error(`manifest not found: ${manifestPath}`);
            process.exit(3);
        }
        const manifestRaw = await fs_1.default.promises.readFile(manifestPath, 'utf8');
        let manifest = null;
        try {
            manifest = JSON.parse(manifestRaw);
        }
        catch (err) {
            console.error('invalid manifest JSON:', err.message || String(err));
            process.exit(4);
        }
        const expected = manifest.sha256 ?? manifest.digest ?? manifest.hash;
        if (!expected) {
            console.error('manifest missing sha256/hash/digest');
            process.exit(5);
        }
        if (expected.toLowerCase() !== sha256.toLowerCase()) {
            console.error(`manifest SHA mismatch: manifest=${expected} computed=${sha256}`);
            if (!force)
                process.exit(6);
            console.warn('--force provided: continuing despite mismatch');
        }
        else {
            console.log('manifest SHA256 matches computed digest');
        }
    }
    if (dryRun) {
        console.log('dry-run: exiting after digest compute');
        process.exit(0);
    }
    let tempPath = null;
    if (replay || verifyDb) {
        // write to temp file for auditReplay to consume
        tempPath = await writeTempFile('audit-replay-', '.json', buf);
        console.log(`Wrote temporary replay file: ${tempPath}`);
    }
    if (replay) {
        console.log('Replaying into DB using auditReplay.ts ...');
        const args = ['memory-layer/tools/auditReplay.ts', `--from-file=${tempPath}`];
        if (force)
            args.push('--force');
        // spawn via npx ts-node to run TypeScript script
        const status = runCommandSync('npx', ['ts-node', ...args], process.env);
        if (status !== 0) {
            console.error('auditReplay failed with exit code', status);
            process.exit(status ?? 7);
        }
        console.log('Replay completed.');
    }
    if (verifyDb) {
        console.log('Running audit verification tool (verifyTool.ts) against DB...');
        // optionally pass --limit if provided
        const verifyArgs = ['memory-layer/service/audit/verifyTool.ts'];
        const status = runCommandSync('npx', ['ts-node', ...verifyArgs], process.env);
        if (status !== 0) {
            console.error('verifyTool failed with exit code', status);
            process.exit(status ?? 8);
        }
        console.log('verifyTool completed successfully.');
    }
    console.log('verificationCliWrapper: all requested steps completed.');
    if (tempPath) {
        try {
            await fs_1.default.promises.unlink(tempPath);
            console.log('removed temp file', tempPath);
        }
        catch {
            // ignore
        }
    }
}
if (require.main === module) {
    main().catch((err) => {
        console.error('verificationCliWrapper failed:', err.message || String(err));
        process.exit(10);
    });
}
