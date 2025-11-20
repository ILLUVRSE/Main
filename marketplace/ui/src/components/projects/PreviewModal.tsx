'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { Project, ProjectPreview } from '@/types/project';
import { previewProject } from '@/lib/api';

export interface ProjectPreviewModalProps {
  project: Project | null;
  open: boolean;
  onClose: () => void;
  onRequestSign: (project: Project) => void;
}

export function PreviewModal({ project, open, onClose, onRequestSign }: ProjectPreviewModalProps) {
  const [data, setData] = useState<ProjectPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !project) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    previewProject(project.id)
      .then((result) => {
        setData(result);
      })
      .catch((err) => {
        setError(err.message);
      })
      .finally(() => setLoading(false));
  }, [open, project?.id]);

  if (!project) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Preview ${project.name}`}
      subtitle={`Session proof & manifest for ${project.category}`}
    >
      {loading && <Skeleton className="h-40 w-full rounded-2xl" />}

      {!loading && error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {!loading && data && (
        <div className="space-y-4">
          <div>
            <p className="font-accent text-xs uppercase tracking-[0.4em] text-[var(--color-text-muted)]">Session ID</p>
            <p className="font-mono text-sm">{data.sessionId}</p>
          </div>
          <div>
            <p className="font-accent text-xs uppercase tracking-[0.4em] text-[var(--color-text-muted)]">Manifest JSON</p>
            <pre className="max-h-60 overflow-auto rounded-2xl bg-[var(--color-surface)] p-4 text-sm leading-relaxed">
              {JSON.stringify(data.manifest, null, 2)}
            </pre>
          </div>
          <div className="rounded-2xl border border-[var(--color-outline)] p-4">
            <p className="font-accent text-xs uppercase tracking-[0.4em] text-[var(--color-text-muted)]">Assets</p>
            <ul className="mt-3 space-y-2 text-sm">
              {(data.assets ?? []).map((asset) => (
                <li key={asset.name} className="flex items-center justify-between">
                  <span>{asset.name}</span>
                  <a
                    href={asset.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[var(--color-primary-accessible)] underline"
                  >
                    View
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="mt-6 flex justify-end gap-3">
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
        <Button variant="primary" onClick={() => onRequestSign(project)} disabled={!data}>
          Request Signing
        </Button>
      </div>
    </Modal>
  );
}

export default PreviewModal;
