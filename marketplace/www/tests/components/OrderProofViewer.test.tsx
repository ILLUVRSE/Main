import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OrderProofViewer } from "@/components/OrderProofViewer";
import { DeliveryProof } from "@/lib/types";
import { verifyDeliveryProof } from "@/lib/api";

jest.mock("@/lib/api", () => ({
  verifyDeliveryProof: jest.fn(),
}));

const mockVerify = verifyDeliveryProof as jest.MockedFunction<typeof verifyDeliveryProof>;

const proof: DeliveryProof = {
  id: "proof_demo",
  createdAt: "2025-01-01T00:00:00Z",
  evidenceHash: "0x123",
  merkleRoot: "0xabc",
};

describe("OrderProofViewer", () => {
  beforeEach(() => {
    mockVerify.mockReset();
  });

  it("invokes verification and shows success", async () => {
    mockVerify.mockResolvedValue({ verified: true, proofId: proof.id });
    render(<OrderProofViewer proof={proof} />);

    fireEvent.click(screen.getByRole("button", { name: /verify/i }));

    await waitFor(() => {
      expect(screen.getByText(/verified/i)).toBeInTheDocument();
    });
  });
});
