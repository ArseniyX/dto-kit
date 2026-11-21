// A small JS/TS tokenizer: enough to find imports and identifiers without being fooled by strings, comments,
// template literals or regex literals (class-validator code is full of `@Matches(/^[a-z]+$/)`).
export type TokKind = "id" | "punct" | "str" | "tpl" | "regex" | "comment" | "num" | "ws";
export interface Tok {
  kind: TokKind;
  start: number;
  end: number;
  text: string;
}

const REGEX_AFTER_PUNCT = new Set(["(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "~", "^"]);
const REGEX_AFTER_WORD = new Set(["return", "typeof", "case", "in", "of", "delete", "void", "throw", "new", "else", "do", "instanceof", "yield", "await"]);
const isIdStart = (c: string) => /[A-Za-z_$\u0080-￿]/.test(c);
const isIdPart = (c: string) => /[\w$\u0080-￿]/.test(c);

function skipString(src: string, i: number): number {
  const q = src[i]!;
  let j = i + 1;
  while (j < src.length && src[j] !== q && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
  return Math.min(j + 1, src.length);
}

/** Skip a template literal starting at the opening backtick, including nested `${ ... }` expressions. */
function skipTemplate(src: string, i: number): number {
  let j = i + 1;
  while (j < src.length) {
    const c = src[j]!;
    if (c === "\\") j += 2;
    else if (c === "`") return j + 1;
    else if (c === "$" && src[j + 1] === "{") j = skipBalanced(src, j + 1);
    else j++;
  }
  return src.length;
}

/** `i` is at a `{`; returns the index just after the matching `}`. */
function skipBalanced(src: string, i: number): number {
  let depth = 0;
  let j = i;
  while (j < src.length) {
    const c = src[j]!;
    if (c === "'" || c === '"') j = skipString(src, j);
    else if (c === "`") j = skipTemplate(src, j);
    else if (c === "/" && src[j + 1] === "/") j = src.indexOf("\n", j) === -1 ? src.length : src.indexOf("\n", j);
    else if (c === "/" && src[j + 1] === "*") j = src.indexOf("*/", j + 2) === -1 ? src.length : src.indexOf("*/", j + 2) + 2;
    else {
      if (c === "{") depth++;
      else if (c === "}" && --depth === 0) return j + 1;
      j++;
    }
  }
  return src.length;
}

function skipRegex(src: string, i: number): number {
  let j = i + 1;
  let inClass = false;
  while (j < src.length && src[j] !== "\n") {
    const c = src[j]!;
    if (c === "\\") j += 2;
    else {
      if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) {
        j++;
        while (j < src.length && /[a-z]/i.test(src[j]!)) j++;
        return j;
      }
      j++;
    }
  }
  return j;
}

export function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let prev: Tok | undefined; // previous significant token
  let i = 0;
  const push = (kind: TokKind, end: number) => {
    const t = { kind, start: i, end, text: src.slice(i, end) };
    toks.push(t);
    if (kind !== "ws" && kind !== "comment") prev = t;
    i = end;
  };
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      let j = i + 1;
      while (j < src.length && /\s/.test(src[j]!)) j++;
      push("ws", j);
    } else if (c === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      push("comment", nl === -1 ? src.length : nl);
    } else if (c === "/" && src[i + 1] === "*") {
      const e = src.indexOf("*/", i + 2);
      push("comment", e === -1 ? src.length : e + 2);
    } else if (c === "'" || c === '"') {
      push("str", skipString(src, i));
    } else if (c === "`") {
      push("tpl", skipTemplate(src, i));
    } else if (c === "/" && (!prev || (prev.kind === "punct" && REGEX_AFTER_PUNCT.has(prev.text)) || (prev.kind === "id" && REGEX_AFTER_WORD.has(prev.text)))) {
      push("regex", skipRegex(src, i));
    } else if (isIdStart(c)) {
      let j = i + 1;
      while (j < src.length && isIdPart(src[j]!)) j++;
      push("id", j);
    } else if (/[0-9]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[\w.]/.test(src[j]!)) j++;
      push("num", j);
    } else {
      push("punct", i + 1);
    }
  }
  return toks;
}

/** 1-based line number of a source offset. */
export const lineOf = (src: string, offset: number) => src.slice(0, offset).split("\n").length;
