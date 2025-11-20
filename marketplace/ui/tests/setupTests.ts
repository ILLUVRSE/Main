/**
 * marketplace/ui/tests/setupTests.ts
 *
 * Test setup for Vitest + Testing Library.
 * - Adds jest-dom matchers
 * - Mocks next/image to a simple <img /> for unit tests
 * - Provides a minimal window.matchMedia shim
 * - Ensures `fetch` is available via whatwg-fetch if running in environments without fetch
 *
 * This file is referenced by vitest.config.ts (setupFiles).
 */

import '@testing-library/jest-dom';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import React from 'react';

/* -----------------------
 * Basic DOM shims
 * ----------------------- */

// matchMedia shim for components that use CSS media queries via JS
if (typeof window !== 'undefined' && !('matchMedia' in window)) {
  // Minimal stub compatible with common usage in tests
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

/* -----------------------
 * next/image mock
 * -----------------------
 *
 * Replace Next.js Image component with a plain <img /> for unit tests.
 * This keeps markup predictable and avoids Next's runtime behavior which
 * isn't necessary for most unit tests.
 */
vi.mock(
  'next/image',
  () => {
    return {
      __esModule: true,
      default: (props: any) => {
        // Use React.createElement to avoid JSX transform issues in setup file
        // Ensure style/width/height passed through for layout purposes in tests
const { src, alt, width, height, style = {}, fill, ...rest } = props;
        const imgProps = {
          src: typeof src === 'object' ? (src as any).src || '' : src,
          alt: alt || '',
          width,
          height,
          style,
          ...rest,
        };
        return React.createElement('img', imgProps);
      },
    };
  },
  { virtual: true }
);

/* -----------------------
 * fetch polyfill
 * -----------------------
 *
 * If `fetch` isn't available in the environment, try to polyfill with
 * the whatwg-fetch package (ensure it's installed in devDependencies).
 */
if (typeof globalThis.fetch === 'undefined') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('whatwg-fetch');
  } catch {
    // If whatwg-fetch isn't available, provide a minimal mock that throws
    // so tests fail loudly if they rely on fetch.
    // @ts-ignore
    globalThis.fetch = () => {
      throw new Error('fetch not available. Install whatwg-fetch or provide a mock in tests.');
    };
  }
}

/* -----------------------
 * Cleanup after each test
 * ----------------------- */
afterEach(() => {
  cleanup();
});
