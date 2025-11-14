export interface ReconciliationMetricsPayload {
  mismatches: number;
  windowSeconds: number;
}

class Metrics {
  private journalEntriesPosted = 0;
  private reconciliationFailures = 0;
  private exportLatencies: number[] = [];

  observeJournalEntries(count: number): void {
    this.journalEntriesPosted += count;
    this.log('ledger.entries_posted', { count, total: this.journalEntriesPosted });
  }

  observeReconciliation(report: ReconciliationMetricsPayload): void {
    if (report.mismatches > 0) {
      this.reconciliationFailures += 1;
    }
    this.log('reconciliation.window', {
      mismatches: report.mismatches,
      failures: this.reconciliationFailures,
      windowSeconds: report.windowSeconds,
    });
  }

  observeExportDuration(durationMs: number): void {
    this.exportLatencies.push(durationMs);
    this.log('exports.duration_ms', { durationMs });
  }

  private log(event: string, payload: Record<string, unknown>): void {
    if (process.env.FINANCE_METRICS_STDOUT === 'false') return;
    console.log(JSON.stringify({ ts: new Date().toISOString(), event, payload }));
  }
}

export const metrics = new Metrics();
