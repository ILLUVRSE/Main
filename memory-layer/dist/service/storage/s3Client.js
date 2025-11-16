"use strict";
/**
 * memory-layer/service/storage/s3Client.ts
 *
 * Compatibility shim that exports the v3-based S3 helpers implemented in
 * s3Client_v3.ts. Keep this file so other modules can continue importing
 * from './s3Client' without requiring changes across the codebase.
 *
 * Exports:
 *  - computeSha256FromUrl(artifactUrl: string): Promise<string>
 *  - validateArtifactChecksum(artifactUrl: string, expectedSha256: string): Promise<boolean>
 *
 * IMPORTANT: The real implementation lives in s3Client_v3.ts.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateArtifactChecksum = exports.computeSha256FromUrl = void 0;
const s3Client_v3_1 = __importDefault(require("./s3Client_v3"));
// Re-export named functions
exports.computeSha256FromUrl = s3Client_v3_1.default.computeSha256FromUrl;
exports.validateArtifactChecksum = s3Client_v3_1.default.validateArtifactChecksum;
exports.default = {
    computeSha256FromUrl: exports.computeSha256FromUrl,
    validateArtifactChecksum: exports.validateArtifactChecksum
};
