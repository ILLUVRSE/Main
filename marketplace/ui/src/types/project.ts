export type ProjectStatus = 'draft' | 'preview' | 'signed';

export interface Project {
  id: string;
  name: string;
  slug: string;
  summary: string;
  description: string;
  category: string;
  status: ProjectStatus;
  price: number;
  currency: 'USD' | 'ILV' | string;
  badges: string[];
  thumbnail: string;
  heroImage: string;
  manifestUrl: string;
  assets?: { name: string; url: string }[];
  metrics: {
    edition: number;
    collectors: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface ProjectPreview {
  sessionId: string;
  manifest: Record<string, unknown>;
  assets: { name: string; url: string }[];
}

export interface SignResponse {
  ok: boolean;
  manifestSignatureId: string;
}
