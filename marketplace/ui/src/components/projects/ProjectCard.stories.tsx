import type { Meta, StoryObj } from '@storybook/react';
import ProjectCard from './ProjectCard';
import { Project } from '@/types/project';

const sampleProject: Project = {
  id: 'proj-hero',
  slug: 'luminous-harbor',
  name: 'Luminous Harbor',
  summary: 'Immersive sentinel narrative exploring orbital beacons.',
  description: 'Full description',
  category: 'Narrative',
  status: 'preview',
  price: 4800,
  currency: 'USD',
  badges: ['featured'],
  thumbnail: '/brand/hero-composite.png',
  heroImage: '/brand/hero-composite.png',
  manifestUrl: 'https://example.com/manifest.json',
  metrics: { edition: 12, collectors: 320 },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const meta: Meta<typeof ProjectCard> = {
  title: 'Projects/ProjectCard',
  component: ProjectCard,
  args: {
    project: sampleProject,
  },
};

export default meta;
type Story = StoryObj<typeof ProjectCard>;

export const Default: Story = {};
