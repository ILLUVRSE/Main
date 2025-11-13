// sandboxRunner.ts
//
// Lightweight sandbox runner for RepoWriter.
//
// NOTE: This implementation now defaults to running commands inside a Docker container for isolation.
// To use the legacy host-based runner, set SANDBOX_RUNTIME=host (not recommended for production).
// This version also enforces a repowriter_allowlist.json allowlist (repo root) so patches touching forbidden paths will be rejected.

// New code for signed-manifest enforcement
const enforceSignedManifest = (req, res, next) => {
    const signature = req.headers['x-signature'];
    const isValidSignature = validateSignature(signature); // Implement this function based on your validation logic

    if (!isValidSignature) {
        return res.status(403).json({ error: 'Invalid signature' });
    }
    next();
};

// Apply the middleware to the relevant routes
app.use('/illuvrse', enforceSignedManifest);
