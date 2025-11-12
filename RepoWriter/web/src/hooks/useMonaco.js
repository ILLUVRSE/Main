import { useRef, useCallback } from "react";
/**
 * useMonaco
 *
 * Lightweight hook to expose Monaco editor and model helpers.
 * It is intended to be used alongside @monaco-editor/react which supplies
 * the onMount callback (editor, monaco). This hook captures those references
 * and exposes utility functions (getValue / setValue / getModel / disposeModel).
 *
 * Usage:
 *  const { onMount, getValue, setValue } = useMonaco();
 *  <MonacoEditor onMount={onMount} ... />
 *
 * Note: this hook deliberately does not import monaco directly so consumers
 * can control loading via @monaco-editor/react or other loaders.
 */
export default function useMonaco() {
    const editorRef = useRef(null);
    const monacoRef = useRef(null);
    const onMount = useCallback((editor, monaco) => {
        editorRef.current = editor;
        monacoRef.current = monaco;
    }, []);
    const getValue = useCallback((modelUri) => {
        try {
            if (!editorRef.current)
                return "";
            if (modelUri && monacoRef.current) {
                const model = monacoRef.current.editor.getModel(monacoRef.current.Uri.parse(modelUri));
                return model ? model.getValue() : "";
            }
            return editorRef.current.getModel().getValue();
        }
        catch {
            return "";
        }
    }, []);
    const setValue = useCallback((value, options) => {
        try {
            if (!editorRef.current)
                return;
            if (options?.modelUri && monacoRef.current) {
                const model = monacoRef.current.editor.getModel(monacoRef.current.Uri.parse(options.modelUri));
                if (model) {
                    model.pushEditOperations([], [{ range: model.getFullModelRange(), text: value }], () => null);
                }
                return;
            }
            const model = editorRef.current.getModel();
            model.pushEditOperations([], [{ range: model.getFullModelRange(), text: value }], () => null);
            if (options?.setSelection) {
                const lineCount = model.getLineCount();
                editorRef.current.setSelection({
                    startLineNumber: 1,
                    startColumn: 1,
                    endLineNumber: lineCount,
                    endColumn: model.getLineMaxColumn(lineCount)
                });
            }
        }
        catch {
            // swallow
        }
    }, []);
    const getModel = useCallback(() => {
        try {
            if (!editorRef.current)
                return null;
            return editorRef.current.getModel();
        }
        catch {
            return null;
        }
    }, []);
    const disposeModel = useCallback((modelUri) => {
        try {
            if (!monacoRef.current)
                return;
            const u = monacoRef.current.Uri.parse(modelUri);
            const m = monacoRef.current.editor.getModel(u);
            if (m)
                m.dispose();
        }
        catch {
            // ignore
        }
    }, []);
    return {
        editorRef,
        monacoRef,
        onMount,
        getValue,
        setValue,
        getModel,
        disposeModel
    };
}
