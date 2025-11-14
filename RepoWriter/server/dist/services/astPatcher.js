/**
 * astPatcher.ts
 *
 * Best-effort AST-aware patch helpers for JS / TS files.
 *
 * Strategy:
 *  - Try to use 'recast' + '@babel/parser' to parse and replace top-level declarations.
 *  - If recast is not installed, fall back to a regex + brace-matching replacer that
 *    attempts to replace function/class/variable declarations by name.
 *
 * Exports:
 *  - applyReplacements(replacements, opts) => Promise<AppliedEntry[]>
 *
 * Replacement format:
 *  {
 *    path: "src/foo.ts",
 *    replaces: [
 *      { name: "myFunc", newCode: "export function myFunc(...) { ... }" },
 *      ...
 *    ]
 *  }
 *
 * Note: paths are repository-relative; this uses REPO_PATH from config.
 */
import fs from "fs/promises";
import path from "path";
import { REPO_PATH } from "../config.js";
/** Helper: naive bracket matcher to find the end index of a block starting at openPos. */
function findMatchingBraceIndex(text, openPos) {
    let i = openPos;
    const len = text.length;
    let depth = 0;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inTemplate = false;
    let inRegex = false;
    let inLineComment = false;
    let inBlockComment = false;
    while (i < len) {
        const ch = text[i];
        const ch1 = text[i + 1];
        // handle comments
        if (!inSingleQuote && !inDoubleQuote && !inTemplate && !inRegex) {
            if (!inBlockComment && ch === "/" && ch1 === "/") {
                inLineComment = true;
                i += 2;
                continue;
            }
            if (!inLineComment && ch === "/" && ch1 === "*") {
                inBlockComment = true;
                i += 2;
                continue;
            }
        }
        if (inLineComment) {
            if (ch === "\n")
                inLineComment = false;
            i++;
            continue;
        }
        if (inBlockComment) {
            if (ch === "*" && ch1 === "/") {
                inBlockComment = false;
                i += 2;
                continue;
            }
            i++;
            continue;
        }
        // handle string/template/regex
        if (!inSingleQuote && !inDoubleQuote && !inTemplate && ch === "/") {
            // Could be regex or division; best-effort: if previous non-space is identifier or ) or ] then division
            // For simplicity, skip trying to detect regex reliably, assume not regex if previous non-space is identifier/number.
            const prev = (() => {
                let j = i - 1;
                while (j >= 0 && /\s/.test(text[j]))
                    j--;
                return text[j] || "";
            })();
            if (!/[a-zA-Z0-9\)\]\}]/.test(prev)) {
                inRegex = true;
                i++;
                continue;
            }
        }
        if (inRegex) {
            if (ch === "/" && text[i - 1] !== "\\") {
                inRegex = false;
            }
            i++;
            continue;
        }
        if (!inDoubleQuote && !inTemplate && ch === "'" && text[i - 1] !== "\\") {
            inSingleQuote = !inSingleQuote;
            i++;
            continue;
        }
        if (!inSingleQuote && !inTemplate && ch === '"' && text[i - 1] !== "\\") {
            inDoubleQuote = !inDoubleQuote;
            i++;
            continue;
        }
        if (!inSingleQuote && !inDoubleQuote && ch === "`" && text[i - 1] !== "\\") {
            inTemplate = !inTemplate;
            i++;
            continue;
        }
        if (inTemplate) {
            // handle ${ ... } in template
            if (ch === "$" && text[i + 1] === "{") {
                // find matching }
                i += 2;
                let innerDepth = 1;
                while (i < len && innerDepth > 0) {
                    if (text[i] === "}" && text[i - 1] !== "\\")
                        innerDepth--;
                    else if (text[i] === "{" && text[i - 1] !== "\\")
                        innerDepth++;
                    i++;
                }
                continue;
            }
            i++;
            continue;
        }
        // braces counting
        if (ch === "{") {
            depth++;
            i++;
            continue;
        }
        else if (ch === "}") {
            depth--;
            i++;
            if (depth === 0) {
                return i; // index after matching brace
            }
            continue;
        }
        else {
            i++;
            continue;
        }
    }
    return -1;
}
/** Try to replace a top-level declaration by name using regex/brute force heuristic. */
function replaceDeclarationNaive(content, name, newCode) {
    // We will try function, class, and variable declarations.
    // Patterns (multiline, not global):
    const patterns = [
        // export async function name(
        new RegExp(`(^|\\n)\\s*(export\\s+)?(async\\s+)?function\\s+${name}\\s*\\(`, "m"),
        // export default function name(
        new RegExp(`(^|\\n)\\s*(export\\s+)?(default\\s+)?function\\s+${name}\\s*\\(`, "m"),
        // class
        new RegExp(`(^|\\n)\\s*(export\\s+)?(default\\s+)?class\\s+${name}\\b`, "m"),
        // const/let/var name =
        new RegExp(`(^|\\n)\\s*(export\\s+)?(const|let|var)\\s+${name}\\s*=`, "m")
    ];
    for (const p of patterns) {
        const m = content.match(p);
        if (!m)
            continue;
        const start = m.index ?? 0;
        // For function/class, find opening brace afterwards
        // Find position of first "{" after the match start
        const bracePos = content.indexOf("{", start);
        if (bracePos === -1)
            continue;
        const end = findMatchingBraceIndex(content, bracePos);
        if (end === -1)
            continue;
        // Replace from start to end with newCode
        const before = content.slice(0, start);
        const after = content.slice(end);
        const replaced = before + "\n" + newCode + "\n" + after;
        return replaced;
    }
    // As a last resort, try to replace a simple "export const name = " until semicolon/newline
    const varPattern = new RegExp(`(^|\\n)\\s*(export\\s+)?(const|let|var)\\s+${name}\\s*=`, "m");
    const vm = content.match(varPattern);
    if (vm) {
        const start = vm.index ?? 0;
        let i = content.indexOf("=", start);
        if (i === -1)
            return content;
        // scan until semicolon or newline followed by non-indented line
        let end = i;
        let semPos = content.indexOf(";", end);
        if (semPos !== -1) {
            // include semicolon
            end = semPos + 1;
        }
        else {
            // fallback: look for two newlines or end of file
            const twoNewline = content.indexOf("\n\n", end);
            end = twoNewline !== -1 ? twoNewline + 2 : content.length;
        }
        const before = content.slice(0, start);
        const after = content.slice(end);
        return before + "\n" + newCode + "\n" + after;
    }
    // If nothing matched, return null to indicate no replacement
    return null;
}
/** Try AST replacement using recast + @babel/parser.
 * This function attempts to locate top-level declarations and replace the AST node
 * with a newly-parsed node constructed from newCode. */
async function replaceWithRecast(content, name, newCode) {
    try {
        // dynamic import to avoid hard dependency
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const recast = await import("recast");
        // Try to use @babel/parser if available, otherwise fallback to recast's default parser
        let parser = undefined;
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const babelParser = await import("@babel/parser");
            parser = {
                parse(source) {
                    return babelParser.parse(source, {
                        sourceType: "module",
                        plugins: [
                            "typescript",
                            "jsx",
                            "classProperties",
                            "decorators-legacy",
                            "optionalChaining",
                            "nullishCoalescingOperator",
                            "objectRestSpread",
                            "dynamicImport"
                        ]
                    });
                }
            };
        }
        catch {
            // try recast/parsers/typescript
            try {
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                // @ts-ignore
                const tsParser = (await import("recast/parsers/typescript")).default;
                parser = tsParser;
            }
            catch {
                // leave undefined (recast will select default)
            }
        }
        const ast = recast.parse(content, { parser });
        const b = recast.types.builders;
        let replaced = false;
        recast.types.visit(ast, {
            visitFunctionDeclaration(pathNode) {
                const node = pathNode.node;
                if (node.id && node.id.name === name) {
                    // parse newCode to get its node
                    const newAst = recast.parse(newCode, { parser });
                    const newNode = newAst.program.body[0];
                    pathNode.replace(newNode);
                    replaced = true;
                    return false;
                }
                this.traverse(pathNode);
            },
            visitClassDeclaration(pathNode) {
                const node = pathNode.node;
                if (node.id && node.id.name === name) {
                    const newAst = recast.parse(newCode, { parser });
                    const newNode = newAst.program.body[0];
                    pathNode.replace(newNode);
                    replaced = true;
                    return false;
                }
                this.traverse(pathNode);
            },
            visitVariableDeclaration(pathNode) {
                const decls = pathNode.node.declarations || [];
                for (const d of decls) {
                    if (d.id && d.id.name === name) {
                        const newAst = recast.parse(newCode, { parser });
                        const newNode = newAst.program.body[0];
                        pathNode.replace(newNode);
                        replaced = true;
                        return false;
                    }
                }
                this.traverse(pathNode);
            }
        });
        if (!replaced)
            return null;
        const out = recast.print(ast).code;
        return out;
    }
    catch (err) {
        // recast not available or failed; return null to let caller fallback.
        return null;
    }
}
/**
 * Apply replacements to files.
 * Returns array of AppliedEntry similar to patcher.
 */
export async function applyReplacements(replacements, opts = {}) {
    const results = [];
    for (const r of replacements) {
        const rel = r.path;
        if (!rel)
            throw new Error("Missing path in replacement");
        const abs = path.resolve(REPO_PATH, rel);
        let previous = null;
        try {
            previous = await fs.readFile(abs, "utf8");
        }
        catch (err) {
            if (err?.code === "ENOENT") {
                previous = null;
            }
            else {
                throw err;
            }
        }
        let newContent = previous ?? "";
        for (const rep of r.replaces) {
            const name = rep.name;
            const newCode = rep.newCode;
            let replacedContent = null;
            // Try AST if preferAst true, then fallback
            if (opts.preferAst !== false) {
                replacedContent = await replaceWithRecast(newContent, name, newCode);
            }
            if (!replacedContent) {
                // Try naive replacer
                replacedContent = replaceDeclarationNaive(newContent, name, newCode);
            }
            if (!replacedContent) {
                // If we couldn't find a declaration to replace, append the new code at end
                replacedContent = newContent + "\n\n" + newCode + "\n";
            }
            newContent = replacedContent;
        }
        // write file if changed
        const wasCreated = previous === null;
        if (previous !== newContent) {
            // ensure directory
            await fs.mkdir(path.dirname(abs), { recursive: true });
            await fs.writeFile(abs, newContent, "utf8");
        }
        results.push({ path: rel, wasCreated, previousContent: previous });
    }
    return results;
}
export default { applyReplacements };
