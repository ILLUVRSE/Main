import React, { useState, useEffect } from "react";

type Props = {
  /**
   * Whether dialog is open
   */
  open: boolean;

  /**
   * The clarifying question text from the model
   */
  question: string;

  /**
   * Optional suggested answers (model-generated)
   */
  suggestions?: string[];

  /**
   * Callback invoked when the user answers. Receives the answer string.
   */
  onAnswer: (answer: string) => void;

  /**
   * Callback invoked when the user cancels/declines to answer.
   */
  onCancel?: () => void;

  /**
   * Optional title for dialog
   */
  title?: string;
};

export default function ClarifyDialog({ open, question, suggestions = [], onAnswer, onCancel, title = "Clarifying question" }: Props) {
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
    <div style={{
      position: "fixed",
      left: 0, top: 0, right: 0, bottom: 0,
      background: "rgba(0,0,0,0.35)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 2000
    }}>
      <div style={{
        width: 740,
        maxWidth: "95%",
        background: "#fff",
        borderRadius: 8,
        padding: 16,
        boxShadow: "0 8px 32px rgba(0,0,0,0.2)"
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>
          <div style={{ fontSize: 13, color: "#666" }}>
            <button onClick={() => onCancel?.()} style={{ background: "transparent", border: "none", cursor: "pointer", color: "#888" }}>✕</button>
          </div>
        </div>

        <div style={{ marginBottom: 12, whiteSpace: "pre-wrap", fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial", fontSize: 14 }}>
          <div style={{ marginBottom: 8, color: "#222" }}>{question}</div>

          {suggestions && suggestions.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 13, color: "#444", marginBottom: 6 }}>Suggested answers</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => setSelectedSuggestion(i)}
                    style={{
                      padding: "6px 10px",
                      borderRadius: 6,
                      border: selectedSuggestion === i ? "1px solid #2563eb" : "1px solid #e6e6e6",
                      background: selectedSuggestion === i ? "#eef4ff" : "#fafafa",
                      cursor: "pointer",
                      fontSize: 13
                    }}
                  >
                    {s.length > 80 ? s.slice(0, 80) + "…" : s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13, marginBottom: 6, color: "#333" }}>Your answer</div>
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Type your answer here. Be concise."
            rows={6}
            style={{ width: "100%", fontFamily: "monospace", fontSize: 13, padding: 8, borderRadius: 6, border: "1px solid #e6e6e6" }}
          />
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            onClick={() => {
              setAnswer("");
              setSelectedSuggestion(null);
              onCancel?.();
            }}
            style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", cursor: "pointer" }}
          >
            Cancel
          </button>

          <button
            onClick={() => {
              const final = (answer || "").trim();
              if (!final) return;
              onAnswer(final);
            }}
            disabled={!answer || answer.trim().length === 0}
            style={{ padding: "8px 14px", borderRadius: 6, border: "none", background: "#2563eb", color: "#fff", cursor: "pointer" }}
          >
            Submit Answer
          </button>
        </div>
      </div>
    </div>
  );
}

