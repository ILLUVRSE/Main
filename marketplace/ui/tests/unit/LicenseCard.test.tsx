import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import LicenseCard from '@/components/LicenseCard';
import type { License } from '@/types';

// Mock the API module used by LicenseCard
vi.mock('@/lib/api', () => {
  const mock = {
    postLicenseVerify: vi.fn(),
  };
  return {
    __esModule: true,
    default: mock,
    ...mock,
  };
});
import api from '@/lib/api';

describe('LicenseCard', () => {
  const sampleLicense: License = {
    license_id: 'lic-123',
    order_id: 'order-1',
    sku_id: 'sku-abc',
    buyer_id: 'buyer:alice@example.com',
    scope: { type: 'single-user', expires_at: '2026-01-01T00:00:00Z' },
    issued_at: '2025-11-01T00:00:00Z',
    signer_kid: 'artifact-publisher-signer-v1',
    signature: 'BASE64SIG',
    canonical_payload: { foo: 'bar' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock clipboard to avoid errors when tests try to copy
    // @ts-ignore
    global.navigator.clipboard = {
      writeText: vi.fn().mockResolvedValue(undefined),
    };
    // Mock alert to suppress during tests
    // @ts-ignore
    global.alert = vi.fn();
  });

  test('renders license fields and actions', () => {
    render(<LicenseCard license={sampleLicense} expectedBuyerId={sampleLicense.buyer_id} />);

    expect(screen.getByText('License')).toBeInTheDocument();
    expect(screen.getByText(sampleLicense.license_id)).toBeInTheDocument();
    expect(screen.getAllByText(/Buyer:/i)[0]).toBeInTheDocument();
    expect(screen.getByText(sampleLicense.buyer_id)).toBeInTheDocument();

    // Verify buttons present
    expect(screen.getByRole('button', { name: /Verify license/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Download/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Copy/i })).toBeInTheDocument();
  });

  test('calls API to verify license and shows verified result', async () => {
    // Arrange: mock API to return verified true
    (api.postLicenseVerify as any).mockResolvedValue({ verified: true, details: { method: 'signingClient' } });

    render(<LicenseCard license={sampleLicense} expectedBuyerId={sampleLicense.buyer_id} />);

    const verifyBtn = screen.getByRole('button', { name: /Verify license/i });
    fireEvent.click(verifyBtn);

    // Wait for verification result UI
    await waitFor(() => {
      expect(api.postLicenseVerify).toHaveBeenCalledWith(sampleLicense, sampleLicense.buyer_id);
    });

    await waitFor(() => {
      expect(screen.getByText(/Verified/i)).toBeInTheDocument();
      expect(screen.getByText(/signingClient/i)).toBeInTheDocument();
    });
  });

  test('shows error when verification fails', async () => {
    (api.postLicenseVerify as any).mockRejectedValue(new Error('verify failed'));

    render(<LicenseCard license={sampleLicense} expectedBuyerId={sampleLicense.buyer_id} />);

    const verifyBtn = screen.getByRole('button', { name: /Verify license/i });
    fireEvent.click(verifyBtn);

    await waitFor(() => {
      expect(api.postLicenseVerify).toHaveBeenCalled();
    });

    // Expect a failure notice (LicenseCard surfaces message in result or error)
    await waitFor(() => {
      expect(screen.getByText(/Verification failed|Not verified/i)).toBeInTheDocument();
    });
  });
});
