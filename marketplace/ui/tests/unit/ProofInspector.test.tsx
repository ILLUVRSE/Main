import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import ProofInspector from '@/components/ProofInspector';
import type { Proof } from '@/types';

// Mock the API module used by ProofInspector
vi.mock('@/lib/api', () => {
  const mock = {
    getProof: vi.fn(),
    postLicenseVerify: vi.fn(),
  };
  return {
    __esModule: true,
    default: mock,
    ...mock,
  };
});
import api from '@/lib/api';

describe('ProofInspector', () => {
  const sampleProof: Proof = {
    proof_id: 'proof-123',
    artifact_sha256: 'deadbeef',
    manifest_signature_id: 'manifest-sig-1',
    ledger_proof_id: 'ledger-1',
    signer_kid: 'audit-signer-v1',
    signature: 'BASE64SIG',
    ts: '2025-11-01T00:00:00Z',
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

  test('renders proof fields and copy/download controls', async () => {
    render(<ProofInspector proof={sampleProof} />);

    expect(screen.getByText(sampleProof.proof_id)).toBeInTheDocument();
    expect(screen.getByText(/Artifact SHA-256/i)).toBeInTheDocument();
    expect(screen.getByText(sampleProof.artifact_sha256)).toBeInTheDocument();
    expect(screen.getByText(/Signature \(base64\)/i)).toBeInTheDocument();

    // Controls: copy payload, download, verify
    expect(screen.getByRole('button', { name: /Copy payload/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Download JSON/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Verify proof/i })).toBeInTheDocument();

    // Copy payload action should call clipboard.writeText
    fireEvent.click(screen.getByRole('button', { name: /Copy payload/i }));
    await waitFor(() => {
      expect((navigator.clipboard as any).writeText).toHaveBeenCalled();
    });
  });

  test('verify proof uses license verification when canonical_payload contains license', async () => {
    // Prepare a proof that embeds a license in canonical_payload
    const proofWithLicense: Proof = {
      ...sampleProof,
      canonical_payload: { license: { license_id: 'lic-1' } },
    };

    // Mock postLicenseVerify to return verified result
    (api.postLicenseVerify as any).mockResolvedValue({ verified: true, details: { method: 'signingClient' } });

    render(<ProofInspector proof={proofWithLicense} />);

    const verifyBtn = screen.getByRole('button', { name: /Verify proof/i });
    fireEvent.click(verifyBtn);

    await waitFor(() => {
      expect(api.postLicenseVerify).toHaveBeenCalled();
    });

    // Expect verified UI to appear
    await waitFor(() => {
      expect(screen.getByText(/Verified/i)).toBeInTheDocument();
      expect(screen.getByText(/signingClient/i)).toBeInTheDocument();
    });
  });

  test('verify proof falls back to server info when no license present', async () => {
    // Mock api.getProof to return a proof with server-side verified info
    const backendProof: Proof & { verified?: any } = {
      ...sampleProof,
      verified: { ok: true, note: 'server-verified' } as any,
    };
    (api.getProof as any).mockResolvedValue({ proof: backendProof });

    // Provide initial proof (without license). The component's verify will call getProof internally.
    render(<ProofInspector proof={sampleProof} />);

    const verifyBtn = screen.getByRole('button', { name: /Verify proof/i });
    fireEvent.click(verifyBtn);

    await waitFor(() => {
      expect(api.getProof).toHaveBeenCalledWith(sampleProof.proof_id);
    });

    // The UI should display a verification result (either verified true or message)
    await waitFor(() => {
      expect(screen.getByText(/Verification result|Verified/i)).toBeInTheDocument();
    });
  });
});
