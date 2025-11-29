# Run Promotion Tests

## Overview
This document describes how to run the tests for the Promotion & Allocation flows.

## Usage

```bash
./scripts/test-promotion-allocation.sh
```

## What it does

1.  **Eval-Engine Tests**: Runs Go unit tests in `eval-engine/internal/service/` which test the `Promote` orchestration logic.
    -   Mocks the Database (sqlmock).
    -   Mocks Reasoning Graph (httptest).
    -   Mocks Finance Service (httptest).
    -   Verifies that a promotion request results in:
        -   DB insertion (pending status).
        -   Reasoning Graph event emission.
        -   Finance Allocation request.
        -   DB update (accepted status).

2.  **Finance Tests**: (Planned) Runs TypeScript unit tests for the Ledger Service.

## Environment Variables

-   `NODE_ENV`: Set to `test`.
-   `PG_MEM`: Set to `true` to use in-memory Postgres for Node services.
