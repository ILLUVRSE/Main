/**
 * useConfirm
 *
 * Small hook that provides an async `confirm` helper. By default this uses
 * the browser-native `window.confirm` dialog but wrapping it in a Promise
 * makes it easy to replace later with a custom modal-driven implementation.
 *
 * Usage:
 *   const { confirm } = useConfirm();
 *   if (await confirm("Are you sure?")) { ... }
 */

export default function useConfirm() {
  async function confirm(message: string, title?: string): Promise<boolean> {
    // For now use native confirm (synchronous) wrapped in a Promise.
    // Replace this implementation with a modal-based approach if you need
    // richer UI/async confirm behavior.
    try {
      const ok = window.confirm(message);
      return Promise.resolve(ok);
    } catch {
      return Promise.resolve(false);
    }
  }

  return { confirm };
}

