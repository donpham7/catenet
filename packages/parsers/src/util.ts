import type { Node } from "web-tree-sitter";
import type { SymbolFact } from "./types.js";

export const lineOf = (n: Node): number => n.startPosition.row + 1;

/** Strip surrounding quotes/backticks and a Python string prefix (f, r, b, u in any case/combination). */
export function unquote(text: string): string {
  const t = text.replace(/^[rRbBfFuU]{1,2}(?=["'])/, "");
  for (const q of ['"""', "'''", '"', "'", "`"]) {
    if (t.length >= q.length * 2 && t.startsWith(q) && t.endsWith(q))
      return t.slice(q.length, t.length - q.length);
  }
  return t;
}

export function countParseErrors(root: Node): number {
  let n = 0;
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop() as Node;
    if (node.isError || node.isMissing) n++;
    if (node.hasError || node.isError) stack.push(...node.children);
  }
  return n;
}

/** A symbol plus the byte range of its declaration, used to find the enclosing symbol of a reference. */
export interface RangedSymbol {
  fact: SymbolFact;
  start: number;
  end: number;
}

export function enclosingSymbol(symbols: RangedSymbol[], node: Node): string | null {
  let best: RangedSymbol | null = null;
  for (const s of symbols) {
    if (
      s.start <= node.startIndex &&
      node.endIndex <= s.end &&
      (!best || s.end - s.start < best.end - best.start)
    ) {
      best = s;
    }
  }
  return best ? best.fact.qualifiedName : null;
}

/** Depth-first walk that skips subtrees for which `skip` returns true. */
export function walk(root: Node, visit: (n: Node) => void, skip: (n: Node) => boolean = () => false): void {
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop() as Node;
    if (skip(node)) continue;
    visit(node);
    const children = node.namedChildren;
    for (let i = children.length - 1; i >= 0; i--) {
      const c = children[i];
      if (c) stack.push(c);
    }
  }
}
