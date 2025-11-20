export class FinanceError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;

  constructor(message: string, status = 400, code = 'FINANCE_ERROR', details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends FinanceError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

export class IdempotencyConflictError extends FinanceError {
  constructor(message: string) {
    super(message, 409, 'IDEMPOTENCY_CONFLICT');
  }
}
