import { render, screen } from "@testing-library/react";
import { MetricCard } from "@/components/MetricCard";

describe("MetricCard", () => {
  it("renders label and value", () => {
    render(<MetricCard label="Pending" value={3} helper="Awaiting review" intent="warning" />);
    expect(screen.getByText(/Pending/i)).toBeInTheDocument();
    expect(screen.getByTestId("metric-value")).toHaveTextContent("3");
  });
});
