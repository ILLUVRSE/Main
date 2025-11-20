import { render, screen, fireEvent } from "@testing-library/react";
import { ModelCard } from "@/components/ModelCard";
import { demoModels } from "@/lib/mockData";

describe("ModelCard", () => {
  const model = demoModels[0];

  it("renders key metadata", () => {
    render(<ModelCard model={model} onAddToCart={jest.fn()} />);

    expect(screen.getByText(model.title)).toBeInTheDocument();
    expect(screen.getByText(model.owner)).toBeInTheDocument();
    expect(screen.getByText(/Starting at/i)).toBeInTheDocument();
    model.tags.forEach((tag) => expect(screen.getByText(tag)).toBeInTheDocument());
  });

  it("calls add to cart handler", () => {
    const handler = jest.fn();
    render(<ModelCard model={model} onAddToCart={handler} />);

    fireEvent.click(screen.getByRole("button", { name: /add to cart/i }));
    expect(handler).toHaveBeenCalledWith(model);
  });

  it("disables preview button if no handler is provided", () => {
    render(<ModelCard model={model} onAddToCart={jest.fn()} />);
    const previewButton = screen.getByRole("button", { name: /preview/i });
    expect(previewButton).toBeDisabled();
  });
});
