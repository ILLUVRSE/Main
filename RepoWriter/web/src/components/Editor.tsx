import React from "react";
import MonacoEditor from "@monaco-editor/react";

type EditorProps = {
  value: string;
  language?: string;
  onChange?: (v: string) => void;
  height?: string | number;
  readOnly?: boolean;
};

export default function Editor({
  value,
  language = "typescript",
  onChange,
  height = "400px",
  readOnly = false,
}: EditorProps) {
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 6, overflow: "hidden" }}>
      <MonacoEditor
        height={typeof height === "number" ? `${height}px` : String(height)}
        defaultLanguage={language}
        value={value}
        options={{
          readOnly,
          automaticLayout: true,
          minimap: { enabled: false },
          fontSize: 13,
        }}
        onChange={(v) => onChange?.(v ?? "")}
      />
    </div>
  );
}

