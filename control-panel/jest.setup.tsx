import "@testing-library/jest-dom";
import React from "react";

jest.mock("next/image", () => ({
  __esModule: true,
  default: ({ src = "", alt = "", ...rest }: { src?: string; alt?: string }) =>
    React.createElement("img", { src, alt, ...rest }),
}));
