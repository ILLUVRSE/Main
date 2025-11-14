/* Minimal global type shims for third-party assets we import from the web UI */

/* Monaco - we use dynamic import and don't need full types here */
declare module "monaco-editor" {
  const monaco: any;
  export = monaco;
}

/* diff2html main export */
declare module "diff2html" {
  export const Diff2Html: any;
  export function parse(diff: string, options?: any): any;
  export function getPrettyHtml(diffInput: string, options?: any): string;
  const whatever: any;
  export default whatever;
}

/* CSS imports (for library CSS like diff2html) */
declare module "*.css";

/* SVG / image assets imported as modules */
declare module "*.svg" {
  const src: string;
  export default src;
}

