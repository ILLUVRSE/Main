'use client';

import { useState } from 'react';
import { Project } from '@/types/project';
import ProjectCard from './ProjectCard';
import PreviewModal from './PreviewModal';
import SignModal from './SignModal';

export interface ProjectShowcaseProps {
  projects: Project[];
}

export function ProjectShowcase({ projects }: ProjectShowcaseProps) {
  const [previewTarget, setPreviewTarget] = useState<Project | null>(null);
  const [signTarget, setSignTarget] = useState<Project | null>(null);
  const [signed, setSigned] = useState<Record<string, string>>({});

  return (
    <>
      <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
        {projects.map((project) => (
          <ProjectCard
            key={project.id}
            project={signed[project.id] ? { ...project, status: 'signed' } : project}
            onPreview={() => setPreviewTarget(project)}
          />
        ))}
      </div>

      <PreviewModal
        project={previewTarget}
        open={Boolean(previewTarget)}
        onClose={() => setPreviewTarget(null)}
        onRequestSign={(project) => {
          setSignTarget(project);
          setPreviewTarget(null);
        }}
      />

      <SignModal
        project={signTarget}
        open={Boolean(signTarget)}
        onClose={() => setSignTarget(null)}
        onSigned={(signatureId) => {
          if (signTarget) {
            setSigned((prev) => ({ ...prev, [signTarget.id]: signatureId }));
          }
        }}
      />
    </>
  );
}

export default ProjectShowcase;
