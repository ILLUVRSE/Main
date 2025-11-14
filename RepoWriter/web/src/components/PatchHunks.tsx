import React, { useEffect, useMemo, useState } from "react";
import DiffViewer from "./DiffViewer.tsx";

type PatchObj = {
  path: string;
  content?: string;
  diff?: string;
};

type Hunk = {
  header?: string; // @@ ... @@
  body: string[]; // lines including +/-
  id: string;
};

export default function PatchHunks({
  patch,
  initiallyIncluded = true,
  onChange,
}: {
  patch: PatchObj;
  initiallyIncluded?: boolean;
  onChange?: (patches: PatchObj[]) => void;
}) {
  const { path, diff, content } = patch;
  const [includedMap, setIncludedMap] = useState<Record<string, boolean>>({});

  // Parse diff into hunks or build single-hunk for content patches
  const { hunks, fileHeader } = useMemo(() => {
    if (diff && diff.includes("@@")) {
      // Extract optional file headers (--- +++)
      const lines = diff.split(/\r?\n/);
      const fileHeaderLines = lines.filter((l) => l.startsWith("--- ") || l.startsWith("+++ "));
      // Find hunk starts
      const hunksArr: Hunk[] = [];
      let current: Hunk | null = null;
      for (const line of lines) {
        if (line.startsWith("@@")) {
          if (current) hunksArr.push(current);
          current = { header: line, body: [], id: `${hunksArr.length}` };
        } else if (current) {
          current.body.push(line);
        }
      }
      if (current) hunksArr.push(current);
      return { hunks: hunksArr, fileHeader: fileHeaderLines.join("\n") || undefined };
    } else if (typeof content === "string") {
      // Single pseudo-hunk representing full content replace/create
      const h: Hunk = { header: undefined, body: content.split(/\r?\n/).map((l) => l), id: "0" };
      return { hunks: [h], fileHeader: undefined };
    } else {
      // nothing parseable
      return { hunks: [], fileHeader: undefined };
    }
  }, [diff, content]);

  // initialize includedMap
  useEffect(() => {
    const init: Record<string, boolean> = {};
    hunks.forEach((h) => {
      init[h.id] = initiallyIncluded;
    });
    setIncludedMap(init);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patch.path, diff, content]);

  // Build patch objects for currently included hunks and notify parent
  useEffect(() => {
    const selected = Object.keys(includedMap).filter((k) => includedMap[k]);
    if (!onChange) return;
    if (selected.length === 0) {
      onChange([]);
      return;
    }

    // If original patch had `content` and everything included -> return content patch
    if (content && selected.length === hunks.length) {
      onChange([{ path, content }]);
      return;
    }

    // Otherwise build a unified diff containing headers + selected hunks
    // Build minimal unified diff with file headers if available
    const hunksText: string[] = [];
    selected.forEach((id) => {
      const h = hunks.find((x) => x.id === id);
      if (!h) return;
      if (h.header) {
        hunksText.push(h.header);
        hunksText.push(...h.body);
      } else {
        // content-style hunk -> treat as new file content: use replace format
        // We'll create a simple diff-like body: prefix all lines with '+'
        const plused = h.body.map((ln) => `+${ln}`);
        // Fake a header for this replacement
        hunksText.push("@@ -0,0 +1,@@");
        hunksText.push(...plused);
      }
    });

    // Put file headers if present
    let assembled = "";
    if (fileHeader) {
      // Ensure both --- and +++ lines exist; if only one exists, add placeholders
      const hasOld = fileHeader.includes("--- ");
      const hasNew = fileHeader.includes("+++ ");
      const oldLine = hasOld ? fileHeader.split("\n").find((l) => l.startsWith("--- "))! : `--- a/${path}`;
      const newLine = hasNew ? fileHeader.split("\n").find((l) => l.startsWith("+++ "))! : `+++ b/${path}`;
      assembled = `${oldLine}\n${newLine}\n${hunksText.join("\n")}\n`;
    } else {
      assembled = `--- a/${path}\n+++ b/${path}\n${hunksText.join("\n")}\n`;
    }

    onChange([{ path, diff: assembled }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includedMap, hunks, fileHeader, content, onChange, path]);

  if (hunks.length === 0) {
    return <div>No preview available for this patch.</div>;
  }

  function toggleHunk(id: string) {
    setIncludedMap((prev) => {
      const copy = { ...prev, [id]: !prev[id] };
      return copy;
    });
  }

  function renderHunk(h: Hunk) {
    const key = `hunk-${h.id}`;
    const included = !!includedMap[h.id];
    // Build small textual representation for display
    const hunkText = h.header ? [h.header, ...h.body].join("\n") : h.body.join("\n");
    return (
      <div key={key} style={{ border: "1px solid #e6eef3", borderRadius: 6, padding: 8, marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={included} onChange={() => toggleHunk(h.id)} />
          <div style={{ fontSize: 13, fontWeight: 600 }}>{h.header ?? `(content preview)`}</div>
        </div>
        <div style={{ marginTop: 8 }}>
          <DiffViewer diff={h.header ? `${h.header}\n${h.body.join("\n")}` : undefined} before={undefined} after={h.header ? undefined : h.body.join("\n")} height="220px" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 8, fontWeight: 700 }}>{path}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {hunks.map((h) => renderHunk(h))}
      </div>
    </div>
  );
}

