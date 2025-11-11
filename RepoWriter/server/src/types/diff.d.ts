declare module "diff" {
  /** Apply a unified diff to a string; returns patched string or false on failure. */
  export function applyPatch(oldStr: string, uniDiff: string): string | false;

  /** Create a unified patch (string) from old/new content. */
  export function createPatch(fileName: string, oldStr: string, newStr: string, oldHeader?: string, newHeader?: string): string;

  /** Produce a structured patch representation. */
  export function structuredPatch(oldFileName: string, newFileName: string, oldStr: string, newStr: string, oldHeader?: string, newHeader?: string): any;

  const diff: any;
  export default diff;
}
