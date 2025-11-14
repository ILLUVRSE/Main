// conversationManager.ts

/**
 * Simple conversation store for RepoWriter to support multi-turn planning and clarifying Q&A.
 *
 * Persistence:
 * - Conversations are kept in-memory and periodically flushed to disk at .repowriter/conversations.json
 * - On startup we attempt to load persisted conversations.
 *
 * Reproducible Training:
 * - Records full provenance including codeRef, container digest, dataset checksums, and hyperparameters.
 */

class ConversationManager {
  // Existing properties and methods...

  // New properties for reproducible training
  codeRef: string;
  containerDigest: string;
  datasetChecksums: string[];
  hyperparams: object;

  constructor() {
    // Initialize properties
    this.codeRef = '';
    this.containerDigest = '';
    this.datasetChecksums = [];
    this.hyperparams = {};
  }

  // Method to record provenance
  recordProvenance(codeRef: string, containerDigest: string, datasetChecksums: string[], hyperparams: object) {
    this.codeRef = codeRef;
    this.containerDigest = containerDigest;
    this.datasetChecksums = datasetChecksums;
    this.hyperparams = hyperparams;
  }

  // Other existing methods...
}

export default ConversationManager;