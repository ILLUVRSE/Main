'use client';

import Image from 'next/image';
import { useState } from 'react';
import { Project } from '@/types/project';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import PreviewModal from './PreviewModal';
import SignModal from './SignModal';

export interface ProjectDetailProps {
  project: Project;
}

export function ProjectDetail({ project }: ProjectDetailProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  const [signatureId, setSignatureId] = useState<string | null>(null);

  return (
    <div className="space-y-10">
      <div className="relative aspect-[4/2] overflow-hidden rounded-3xl">
        <Image src={project.heroImage} alt={project.name} fill className="object-cover" sizes="100vw" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
        <div className="absolute bottom-6 left-6 text-white">
          <Badge variant="accent">{project.category}</Badge>
          <h1 className="mt-4 font-heading text-5xl text-white">{project.name}</h1>
          <p className="mt-2 max-w-2xl text-base text-white/90">{project.summary}</p>
        </div>
      </div>

      <div className="grid gap-10 md:grid-cols-[2fr_1fr]">
        <div className="space-y-6 text-[var(--color-text-muted)]">
          <p>{project.description}</p>
          <div className="rounded-3xl border border-[var(--color-outline)] bg-white p-6 shadow-card">
            <h2 className="font-heading text-2xl text-[var(--color-primary-accessible)]">Manifest details</h2>
            <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
              <div>
                <dt className="font-accent uppercase tracking-[0.4em] text-[var(--color-text-muted)]">Status</dt>
                <dd className="capitalize">{signatureId ? 'signed' : project.status}</dd>
              </div>
              <div>
                <dt className="font-accent uppercase tracking-[0.4em] text-[var(--color-text-muted)]">Collectors</dt>
                <dd>{project.metrics.collectors.toLocaleString()}</dd>
              </div>
              <div>
                <dt className="font-accent uppercase tracking-[0.4em] text-[var(--color-text-muted)]">Edition</dt>
                <dd>#{project.metrics.edition.toString().padStart(3, '0')}</dd>
              </div>
              <div>
                <dt className="font-accent uppercase tracking-[0.4em] text-[var(--color-text-muted)]">
                  Manifest URL
                </dt>
                <dd>
                  <a href={project.manifestUrl} className="text-[var(--color-primary-accessible)] underline">
                    View manifest
                  </a>
                </dd>
              </div>
            </dl>
          </div>
        </div>

        <div className="rounded-3xl border border-[var(--color-outline)] bg-white p-6 shadow-card">
          <p className="font-accent text-xs uppercase tracking-[0.4em] text-[var(--color-text-muted)]">Investment</p>
          <p className="mt-3 font-heading text-4xl text-[var(--color-primary-accessible)]">
            {project.currency} {project.price.toLocaleString()}
          </p>
          {signatureId && (
            <p className="mt-2 text-sm text-[var(--color-text-muted)]">
              manifestSignatureId:
              <br />
              <span className="font-mono text-xs">{signatureId}</span>
            </p>
          )}
          <div className="mt-6 space-y-3">
            <Button className="w-full" onClick={() => setPreviewOpen(true)}>
              Preview manifest
            </Button>
            <Button variant="secondary" className="w-full" onClick={() => setSignOpen(true)}>
              Request signing
            </Button>
          </div>
        </div>
      </div>

      <PreviewModal
        project={project}
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        onRequestSign={(_project) => {
          setPreviewOpen(false);
          setSignOpen(true);
        }}
      />

      <SignModal
        project={project}
        open={signOpen}
        onClose={() => setSignOpen(false)}
        onSigned={(id) => setSignatureId(id)}
      />
    </div>
  );
}

export default ProjectDetail;
