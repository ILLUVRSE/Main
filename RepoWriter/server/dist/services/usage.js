import { broadcast } from "../ws/server.js";
let totals = { tokens_est: 0, dollars_est: 0 };
export function addUsage(delta) {
    totals.tokens_est += delta.tokens_est || 0;
    totals.dollars_est += delta.dollars_est || 0;
    broadcast("usage", totals);
}
export function snapshotUsage() {
    return totals;
}
