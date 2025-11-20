import { fireEvent, render, screen } from "@testing-library/react";
import { BuyWidget } from "@/components/BuyWidget";
import { demoModels } from "@/lib/mockData";

describe("BuyWidget", () => {
  const model = demoModels[0];
  const SAMPLE_PEM = `-----BEGIN PUBLIC KEY-----\nabc123\n-----END PUBLIC KEY-----`;

  it("lets buyers pick versions", () => {
    const onSelect = jest.fn();
    render(
      <BuyWidget
        model={model}
        selectedVersionId={model.versions[0].id}
        onSelectVersion={onSelect}
        onAddToCart={jest.fn()}
      />
    );

    const select = screen.getByLabelText("Version", { selector: "select" });
    fireEvent.change(select, { target: { value: model.versions[1].id } });
    expect(onSelect).toHaveBeenCalledWith(model.versions[1].id);
  });

  it("surfaces delivery mode to callbacks", () => {
    const add = jest.fn();
    render(
      <BuyWidget
        model={model}
        selectedVersionId={model.versions[0].id}
        onSelectVersion={jest.fn()}
        onAddToCart={add}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /buyer managed/i }));
    fireEvent.change(screen.getByPlaceholderText(/BEGIN PUBLIC KEY/), { target: { value: SAMPLE_PEM } });
    fireEvent.click(screen.getByRole("button", { name: /Add to cart/i }));
    expect(add).toHaveBeenCalledWith({ deliveryMode: "buyer_managed", pem: SAMPLE_PEM });
  });

  it("prevents submission when PEM is invalid", () => {
    const add = jest.fn();
    render(
      <BuyWidget
        model={model}
        selectedVersionId={model.versions[0].id}
        onSelectVersion={jest.fn()}
        onAddToCart={add}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /buyer managed/i }));
    fireEvent.change(screen.getByPlaceholderText(/BEGIN PUBLIC KEY/), { target: { value: "invalid" } });
    fireEvent.click(screen.getByRole("button", { name: /Add to cart/i }));
    expect(add).not.toHaveBeenCalled();
  });
});
