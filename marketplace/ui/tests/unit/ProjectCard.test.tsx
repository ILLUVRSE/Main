import { render, screen } from '@testing-library/react';
import ProjectCard from '@/components/projects/ProjectCard';
import { Project } from '@/types/project';

const baseProject: Project = {
  id: 'proj-1',
  slug: 'proj-1',
  name: 'Glowing Harbor',
  summary: 'Editorial showcase',
  description: 'Full description',
  category: 'Editorial',
  status: 'preview',
  price: 4200,
  currency: 'USD',
  badges: [],
  thumbnail: '/brand/hero-composite.png',
  heroImage: '/brand/hero-composite.png',
  manifestUrl: '#',
  metrics: { edition: 7, collectors: 125 },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('ProjectCard', () => {
  it('renders project details', () => {
    render(<ProjectCard project={baseProject} />);
    expect(screen.getByRole('heading', { name: /glowing harbor/i })).toBeInTheDocument();
    expect(screen.getAllByText(/editorial/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/USD 4,200/)).toBeInTheDocument();
  });

  it('falls back to placeholder image when missing thumbnail', () => {
    const { container } = render(<ProjectCard project={{ ...baseProject, thumbnail: '' }} />);
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toContain('hero-composite');
  });
});
