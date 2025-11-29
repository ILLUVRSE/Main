# Reasoning Graph Trace API

## `GET /traces/{id}`

Retrieves a fully ordered, causal path of events (nodes and edges) leading up to the specified trace ID (typically a node ID).

### Purpose

To provide a deterministic, auditable, and linear view of the causal history of a reasoning step. This is essential for:
- **Explainability**: Understanding *why* a decision was made.
- **Auditing**: Verifying the chain of custody and integrity of the reasoning process.
- **Debugging**: Tracing back errors or unexpected behaviors.

### Request

- **Path Parameter**: `id` (UUID) - The ID of the node to trace back from.
- **Authentication**: Required (Kernel-signed token or internal mTLS).

### Response

The response is a JSON object containing:

- `trace_id`: The ID of the requested trace root.
- `ordered_path`: An array of `OrderedTraceEntry` objects sorted topologically and causally.
- `metadata`: Information about the trace generation (length, cycle detection, etc.).

#### `OrderedTraceEntry` Schema

| Field | Type | Description |
|---|---|---|
| `id` | UUID | Unique identifier of the node or edge. |
| `type` | string | "node" or "edge". |
| `entityType` | string | The specific type (e.g., "decision", "causal"). |
| `timestamp` | string (ISO8601) | Creation timestamp. |
| `causalIndex` | int | The 0-based index in the linear path. |
| `parentIds` | UUID[] | IDs of immediate causal parents (causes). |
| `annotations` | Array | List of append-only annotations. |
| `auditRef` | Object | Audit verification data (`eventId`, etc.). |
| `payload` | Object | (Nodes only) The content payload. |
| `from` | UUID | (Edges only) Source node ID. |
| `to` | UUID | (Edges only) Target node ID. |

### Ordering Algorithm

1.  **Subgraph Collection**: Transitive closure of ancestors (causes) is collected starting from the requested ID.
2.  **Topological Sort**: A topological sort (Kahn's algorithm) is applied to the subgraph (Nodes + Edges).
    - Edges are treated as first-class citizens: `FromNode -> Edge -> ToNode`.
3.  **Deterministic Tie-Breaking**: When multiple items are available to be added to the path (parallel branches), ties are broken by:
    - **Timestamp** (Ascending): Earliest created items come first.
    - **UUID** (Lexicographical): Stable secondary sort.
4.  **Cycle Handling**: If a cycle is detected:
    - `metadata.cycle_detected` is set to `true`.
    - The acyclic portion is returned first.
    - Remaining items in the cycle (and their dependents) are appended, sorted by timestamp, to ensure no data is hidden.

### Example

```json
{
  "trace_id": "c16f...",
  "ordered_path": [
    {
      "id": "a1...",
      "type": "node",
      "entityType": "observation",
      "timestamp": "2023-10-27T10:00:00Z",
      "causalIndex": 0,
      "parentIds": [],
      "auditRef": { "eventId": "evt_1..." }
    },
    {
      "id": "e1...",
      "type": "edge",
      "entityType": "causal",
      "timestamp": "2023-10-27T10:01:00Z",
      "from": "a1...",
      "to": "b2...",
      "auditRef": { "eventId": "evt_2..." }
    },
    {
      "id": "b2...",
      "type": "node",
      "entityType": "decision",
      "timestamp": "2023-10-27T10:02:00Z",
      "causalIndex": 2,
      "parentIds": ["a1..."],
      "auditRef": { "eventId": "evt_3..." }
    }
  ],
  "metadata": {
    "length": 3,
    "cycle_detected": false
  }
}
```
