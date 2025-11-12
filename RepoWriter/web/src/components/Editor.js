import { jsx as _jsx } from "react/jsx-runtime";
import MonacoEditor from "@monaco-editor/react";
export default function Editor({ value, language = "typescript", onChange, height = "400px", readOnly = false, }) {
    return (_jsx("div", { style: { border: "1px solid #e5e7eb", borderRadius: 6, overflow: "hidden" }, children: _jsx(MonacoEditor, { height: typeof height === "number" ? `${height}px` : String(height), defaultLanguage: language, value: value, options: {
                readOnly,
                automaticLayout: true,
                minimap: { enabled: false },
                fontSize: 13,
            }, onChange: (v) => onChange?.(v ?? "") }) }));
}
