# Kernel Service SLOs

## 1. Availability
**Target:** 99.9% availability over a rolling 30-day window.

**SLI:**
```
(rate(kernel_http_requests_total{status_code!~"5.."}[5m]) / rate(kernel_http_requests_total[5m])) * 100
```
*   **Good Event:** Request returns status code < 500.
*   **Bad Event:** Request returns status code >= 500.

## 2. Latency
**Target:**
*   p95 < 200ms
*   p99 < 500ms

**SLI:**
```
histogram_quantile(0.99, rate(kernel_http_request_duration_seconds_bucket[5m]))
```

## 3. Error Budget
*   **Calculated as:** `100% - Availability Target`
*   **Burn Rate:** Alert if > 2% of error budget consumed in 1 hour.

## 4. Saturation Indicators
*   **CPU Usage:** `kernel_process_cpu_usage_percent` > 80%
*   **Memory Usage:** `kernel_process_memory_usage_bytes` > 80% of container limit.
*   **Queue Depth:** `kernel_job_queue_depth` > 100 items (pending jobs).

## Metrics Reference

| Metric Name | Type | Description | Labels |
|---|---|---|---|
| `kernel_http_requests_total` | Counter | Total HTTP requests | `method`, `route`, `status_code` |
| `kernel_http_request_errors_total` | Counter | Total 5xx errors | `method`, `route`, `status_code` |
| `kernel_http_request_duration_seconds` | Histogram | Request duration | `method`, `route` |
| `kernel_process_cpu_usage_percent` | Gauge | CPU usage (0-100) | |
| `kernel_process_memory_usage_bytes` | Gauge | Heap used | |
| `kernel_job_queue_depth` | Gauge | Pending internal jobs | `queue` |
| `kernel_spawn_count_total` | Counter | Agent/Process spawns | `type`, `status` |
| `kernel_spawn_latency_ms` | Histogram | Latency of spawn ops | `type` |
| `kernel_lifecycle_failure_total` | Counter | Lifecycle op failures | `operation` |
| `kernel_sandbox_run_duration_ms` | Histogram | Sandbox execution time | `agent_id` |
