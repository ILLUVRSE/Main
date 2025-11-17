import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import SkuCard from '@/components/SkuCard';
import type { SkuSummary } from '@/types';

describe('SkuCard', () => {
  const sampleSku: SkuSummary = {
    sku_id: 'sku-abc-123',
    title: 'Sample Model',
    summary: 'A short summary of the sample model.',
    price: 1999,
    currency: 'USD',
    manifest_valid: true,
    thumbnail: '/brand/logo-icon-64.png',
    tags: ['ml-model'],
    author_id: 'actor:alice',
  };

  test('renders title, summary and price', () => {
    render(<SkuCard sku={sampleSku} />);

    expect(screen.getByText('Sample Model')).toBeInTheDocument();
    expect(screen.getByText('A short summary of the sample model.')).toBeInTheDocument();
    expect(screen.getByText('$19.99')).toBeInTheDocument();
    // verified badge should be present
    expect(screen.getByText(/Verified/i)).toBeInTheDocument();
  });

  test('calls onPreview when Preview button clicked', () => {
    const onPreview = vi.fn();
    render(<SkuCard sku={sampleSku} onPreview={onPreview} />);

    const previewBtn = screen.getByRole('button', { name: /Preview/i });
    expect(previewBtn).toBeInTheDocument();
    fireEvent.click(previewBtn);
    expect(onPreview).toHaveBeenCalledWith('sku-abc-123');
  });

  test('renders Buy link that navigates to checkout', () => {
    render(<SkuCard sku={sampleSku} />);

    const buyBtn = screen.getByRole('link', { name: /Buy/i });
    expect(buyBtn).toBeInTheDocument();
    expect(buyBtn.getAttribute('href') || '').toContain('/checkout?sku=sku-abc-123');
  });
});

