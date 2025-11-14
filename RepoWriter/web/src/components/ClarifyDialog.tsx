import React, { useEffect, useState } from "react";

/**
 * ClarifyDialog (themed)
 *
 * Replaces inline layout with theme classes:
 * - Uses .modal-backdrop and .modal from illuvrse.css
 * - Buttons use .btn / .btn-primary / .btn-ghost
 *
 * Props:
 *  - open: boolean
 *  - question: string
 *  - suggestions?: string[]
 *  - onAnswer(answer: string): void
 *  - onCancel?: () => void
 *  - title?: string
 */

type Props = {
  open: boolean;
  question: string;
  suggestions?: string[];
  onAnswer: (answer: string) => void;
  onCancel?: () => void;
  title?: string;
};

export default function ClarifyDialog({
  open,
  question,
  suggestions = [],
  onAnswer,
  onCancel,
  title = "Clarifying question",
}: Props) {
  const [answer, setAnswer] = useState<string>("");
  const [selectedSuggestion, setSelectedSuggestion] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      setAnswer("");
      setSelectedSuggestion(null);
    }
  }, [open, question]);

  useEffect(() => {
    if (selectedSuggestion !== null && suggestions[selectedSuggestion]) {
      setAnswer(suggestions[selectedSuggestion]);
    }
  }, [selectedSuggestion, suggestions]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="clarify-title">
      <div className="modal" role="document" style={{ maxWidth: 760 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div id="clarify-title" style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>
          <div>
            <button
              className="btn btn-ghost btn-small"
              onClick={() => onCancel?.()}
              aria-label="Close dialog"
              title="Close"
            >
              ✕
            </button>
          </div>
        </div>

        <div style={{ marginBottom: 12, whiteSpace: "pre-wrap", fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial", fontSize: 14 }}>
          <div style={{ marginBottom: 8, color: "var(--text)" }}>{question}</div>

          {suggestions && suggestions.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 6 }}>Suggested answers</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => setSelectedSuggestion(i)}
                    className={`btn ${selectedSuggestion === i ? "btn-primary" : "btn-ghost"}`}
                    style={{ padding: "6px 10px", borderRadius: 6 }}
                  >
                    {s.length > 80 ? s.slice(0, 80) + "…" : s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13, marginBottom: 6, color: "var(--text)" }}>Your answer</div>
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Type your answer here. Be concise."
            rows={6}
            style={{ width: "100%", fontFamily: "monospace", fontSize: 13, padding: 8, borderRadius: 6, border: "1px solid rgba(0,0,0,0.06)" }}
          />
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            className="btn"
            onClick={() => {
              setAnswer("");
              setSelectedSuggestion(null);
              onCancel?.();
            }}
          >
            Cancel
          </button>

          <button
            className="btn btn-primary"
            onClick={() => {
              const final = (answer || "").trim();
              if (!final) return;
              onAnswer(final);
            }}
            disabled={!answer || answer.trim().length === 0}
          >
            Submit Answer
          </button>
        </div>
      </div>
    </div>
  );
}

