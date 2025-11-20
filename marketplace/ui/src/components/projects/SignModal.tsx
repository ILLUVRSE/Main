'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Project } from '@/types/project';
import { requestSign } from '@/lib/api';

export interface SignModalProps {
  project: Project | null;
  open: boolean;
  onClose: () => void;
  onSigned?: (manifestSignatureId: string) => void;
}

export function SignModal({ project, open, onClose, onSigned }: SignModalProps) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'complete'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [signatureId, setSignatureId] = useState<string | null>(null);

  if (!project) return null;

  const handleSign = async () => {
    setStatus('loading');
    setError(null);
    try {
      const response = await requestSign(project.id);
      setSignatureId(response.manifestSignatureId);
      setStatus('complete');
      onSigned?.(response.manifestSignatureId);
    } catch (err) {
      setError((err as Error).message);
      setStatus('idle');
    }
  };

  const handleClose = () => {
    setStatus('idle');
    setError(null);
    setSignatureId(null);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Request Signing"
      subtitle={`Submit ${project.name} for Kernel verification`}
    >
      <p className="text-sm text-[var(--color-text-muted)]">
        This action will call <code>/api/kernel/sign</code> with the manifest hash for this project. A{' '}
        <span className="font-mono">manifestSignatureId</span> is returned for audit trails.
      </p>

      {signatureId && (
        <div className="mt-4 rounded-2xl border border-[var(--color-outline)] bg-[var(--color-surface)] p-4">
          <p className="font-accent text-xs uppercase tracking-[0.4em] text-[var(--color-text-muted)]">Signature ID</p>
          <p className="font-mono text-sm">{signatureId}</p>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>
      )}

      <div className="mt-6 flex justify-end gap-3">
        <Button variant="ghost" onClick={handleClose}>
          Cancel
        </Button>
        <Button onClick={handleSign} loading={status === 'loading'} disabled={status === 'complete'}>
          {status === 'complete' ? 'Signed' : 'Request signature'}
        </Button>
      </div>
    </Modal>
  );
}

export default SignModal;
