import "@testing-library/jest-dom";
import React from "react";

jest.mock("next/image", () => ({
  __esModule: true,
  default: ({ src = "", alt = "", ...rest }: { src?: string; alt?: string }) => {
    const cloned = { ...rest } as Record<string, unknown>;
    delete cloned.fill;
    // eslint-disable-next-line @next/next/no-img-element
    return React.createElement("img", { src, alt, ...cloned });
  },
}));
