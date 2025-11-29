# Operational Runbook: Kernel Service

## 1. High Error Rate (Availability Breach)
**Trigger:** 5xx Error Rate > 1% for 5 minutes.
**SLO Impact:** Availability drop.

**Mitigation Steps:**
1.  **Check Logs:** Look for recent exceptions in `kernel` logs.
    ```bash
    kubectl logs -l app=kernel --tail=100
    ```
2.  **Check DB:** Verify Postgres is reachable.
    ```bash
    # Check connection
    pg_isready -h <db-host>
    ```
3.  **Rollback:** If a recent deployment occurred, rollback immediately.
4.  **Scaling:** If CPU/Memory is saturated, scale up replicas.
5.  **Circuit Breaker:** If a downstream service (e.g., KMS) is failing, enable circuit breakers if applicable (or switch to local keys if permitted).

**Verification:**
*   Monitor Error Rate graph until it drops to 0.

## 2. Latency Spike (p99 Breach)
**Trigger:** p99 Latency > 500ms for 5 minutes.

**Mitigation Steps:**
1.  **Identify Bottleneck:** Check `kernel_process_cpu_usage_percent`. If high (>80%), scale up.
2.  **Database:** Check for slow queries or lock contention.
3.  **Dependency:** Check KMS latency.
4.  **Traffic:** Check for DDOS or traffic spike.

## 3. DB Unavailability
**Trigger:** Readiness probe failing with `db.unreachable`.

**Mitigation Steps:**
1.  **Restart DB:** If using a managed service, check provider status. If local/container, restart container.
    ```bash
    docker restart kernel-postgres-1
    ```
2.  **Failover:** Trigger failover to standby if available.

## 4. High Resource Usage (Saturation)
**Trigger:** CPU or Memory > 80%.

**Mitigation Steps:**
1.  **Scale:** Increase replica count.
2.  **Restart:** If memory leak suspected (sawtooth pattern), restart pods.

## 5. Event Bus / Archive Failure
**Trigger:** Audit log append failures in logs.

**Mitigation Steps:**
1.  **Check Disk:** Ensure disk space is available.
2.  **Check Network:** Ensure connectivity to S3/Storage.
