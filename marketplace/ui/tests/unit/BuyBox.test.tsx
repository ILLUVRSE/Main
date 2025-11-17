import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import BuyBox from '@/components/BuyBox';
import type { SkuDetail } from '@/types';

describe('BuyBox', () => {
  const sampleSku: SkuDetail = {
    sku_id: 'sku-xyz-001',
    title: 'Example SKU',
    description: 'An example SKU for testing',
    price: 2500,
    currency: 'USD',
    manifest_valid: true,
    manifest_metadata: {
      metadata: {
        royalties: {
          type: 'percentage',
          splits: [
            { recipient: 'actor:alice', percentage: 10 },
            { recipient: 'actor:bob', percentage: 5 },
          ],
        },
      },
    } as any,
  };

  test('renders price and SKU id', () => {
    render(<BuyBox sku={sampleSku} onBuy={() => {}} onPreview={() => {}} />);
    expect(screen.getByText('$25.00')).toBeInTheDocument();
    expect(screen.getByText(sampleSku.sku_id)).toBeInTheDocument();
  });

  test('calls onBuy when Buy button clicked', async () => {
    const onBuy = vi.fn();
    render(<BuyBox sku={sampleSku} onBuy={onBuy} onPreview={() => {}} />);
    const buyBtn = screen.getByRole('button', { name: /Buy/i });
    fireEvent.click(buyBtn);
    expect(onBuy).toHaveBeenCalled();
  });

  test('calls onPreview when Preview button clicked', async () => {
    const onPreview = vi.fn();
    render(<BuyBox sku={sampleSku} onBuy={() => {}} onPreview={onPreview} />);
    const previewBtn = screen.getByRole('button', { name: /Preview/i });
    fireEvent.click(previewBtn);
    expect(onPreview).toHaveBeenCalled();
  });

  test('shows royalty hint when present in manifest metadata', () => {
    render(<BuyBox sku={sampleSku} onBuy={() => {}} onPreview={() => {}} />);
    // royalty hint derived from manifest metadata should display percentages -> recipient
    expect(screen.getByText(/10%→alice/i)).toBeInTheDocument();
  });

  test('disables actions when disabled prop is true', () => {
    const onBuy = vi.fn();
    const onPreview = vi.fn();
    render(<BuyBox sku={sampleSku} onBuy={onBuy} onPreview={onPreview} disabled />);
    const buyBtn = screen.getByRole('button', { name: /Buy/i });
    const previewBtn = screen.getByRole('button', { name: /Preview/i });
    expect(buyBtn).toBeDisabled();
    expect(previewBtn).toBeDisabled();
    fireEvent.click(buyBtn);
    fireEvent.click(previewBtn);
    expect(onBuy).not.toHaveBeenCalled();
    expect(onPreview).not.toHaveBeenCalled();
  });
});

