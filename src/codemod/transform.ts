import { lineOf, tokenize, type Tok } from "./tokenize.js";
import { RENAMES, isAvailable, unavailableReason } from "./manifest.js";

export interface CodemodOptions {
  /** Also swap Nest's `ValidationPipe` for `DtoKitValidationPipe` (imported as `ValidationPipe`, so call sites stay unchanged). */
  nest?: boolean;
}
export interface CodemodWarning {
  line: number;
  message: string;
}
export interface CodemodResult {
  code: string;
  changed: boolean;
  /** What was rewritten, for a report. */
  changes: string[];
  /** Things that need a human. */
  warnings: CodemodWarning[];
}

interface Spec {
  imported: string;
  local: string;
  isType: boolean;
}
interface ImportDecl {
  start: number;
  end: number; // exclusive; includes a trailing ";"
  module: string;
  quote: string;
  semi: boolean;
  typeOnly: boolean;
  namespace?: string;
  defaultName?: string;
  specs: Spec[];
  sideEffect: boolean;
  moduleTok: Tok;
}
interface Edit {
  start: number;
  end: number;
  text: string;
}

const SOURCES = new Set(["class-validator", "class-transformer"]);
const NEST_UNSUPPORTED = ["forbidUnknownValues", "validationError", "errorFormat", "maxErrorMessagesLength", "dismissDefaultMessages", "enableDebugMessages"];
const MODIFIERS = new Set(["public", "private", "protected", "readonly", "static", "declare", "override", "accessor"]);

function parseImports(src: string, sig: Tok[]): ImportDecl[] {
  const out: ImportDecl[] = [];
  for (let i = 0; i < sig.length; i++) {
    const t = sig[i]!;
    if (t.kind !== "id" || t.text !== "import") continue;
    const lineStart = src.lastIndexOf("\n", t.start - 1) + 1;
    if (src.slice(lineStart, t.start).trim() !== "") continue; // not at the start of a line
    const next = sig[i + 1];
    if (!next || next.text === "(" || next.text === ".") continue; // dynamic import / import.meta
    let k = i + 1;
    const decl: ImportDecl = { start: t.start, end: 0, module: "", quote: '"', semi: false, typeOnly: false, specs: [], sideEffect: false, moduleTok: t };
    if (sig[k]!.kind === "str") {
      decl.sideEffect = true;
    } else {
      if (sig[k]!.text === "type" && sig[k + 1] && (sig[k + 1]!.text === "{" || sig[k + 1]!.text === "*" || (sig[k + 1]!.kind === "id" && sig[k + 1]!.text !== "from"))) {
        decl.typeOnly = true;
        k++;
      }
      if (sig[k]!.kind === "id" && sig[k]!.text !== "from") {
        decl.defaultName = sig[k]!.text;
        k++;
        if (sig[k]?.text === ",") k++;
      }
      if (sig[k]?.text === "*") {
        if (sig[k + 1]?.text !== "as" || sig[k + 2]?.kind !== "id") continue;
        decl.namespace = sig[k + 2]!.text;
        k += 3;
      } else if (sig[k]?.text === "{") {
        k++;
        while (sig[k] && sig[k]!.text !== "}") {
          let isType = false;
          if (sig[k]!.text === "type" && sig[k + 1] && sig[k + 1]!.text !== "," && sig[k + 1]!.text !== "}" && sig[k + 1]!.text !== "as") {
            isType = true;
            k++;
          }
          const imported = sig[k]!;
          if (imported.kind !== "id") break;
          let local = imported.text;
          k++;
          if (sig[k]?.text === "as" && sig[k + 1]?.kind === "id") {
            local = sig[k + 1]!.text;
            k += 2;
          }
          decl.specs.push({ imported: imported.text, local, isType });
          if (sig[k]?.text === ",") k++;
        }
        if (sig[k]?.text !== "}") continue;
        k++;
      }
      if (sig[k]?.text !== "from") continue;
      k++;
    }
    const m = sig[k];
    if (!m || m.kind !== "str") continue;
    decl.module = m.text.slice(1, -1);
    decl.quote = m.text[0]!;
    decl.moduleTok = m;
    decl.end = m.end;
    if (sig[k + 1]?.text === ";") {
      decl.semi = true;
      decl.end = sig[k + 1]!.end;
    }
    out.push(decl);
    i = k;
  }
  return out;
}

function fmtImport(specs: Spec[], module: string, o: { quote: string; semi: boolean; typeOnly?: boolean }): string {
  const items = specs.map((s) => `${s.isType && !o.typeOnly ? "type " : ""}${s.imported === s.local ? s.imported : `${s.imported} as ${s.local}`}`);
  const head = `import ${o.typeOnly ? "type " : ""}`;
  const tail = ` from ${o.quote}${module}${o.quote}${o.semi ? ";" : ""}`;
  const one = `${head}{ ${items.join(", ")} }${tail}`;
  return one.length <= 100 ? one : `${head}{\n${items.map((i) => `  ${i},`).join("\n")}\n}${tail}`;
}

/** Whole-line removal: also take the newline so no blank line is left behind. */
function removalRange(src: string, d: { start: number; end: number }): [number, number] {
  const lineStart = src.lastIndexOf("\n", d.start - 1) + 1;
  const onlyThisLine = src.slice(lineStart, d.start).trim() === "" && /^[ \t]*(\r?\n|$)/.test(src.slice(d.end));
  if (!onlyThisLine) return [d.start, d.end];
  const m = /^[ \t]*\r?\n?/.exec(src.slice(d.end))!;
  return [lineStart, d.end + m[0].length];
}

interface Deco {
  at: number; // sig index of "@"
  name: string; // possibly dotted
  open: number; // sig index of "(" or -1
  close: number; // sig index of ")" or -1
  last: number; // sig index of the last token of the decorator
}

function parseDecorator(sig: Tok[], i: number): Deco | undefined {
  if (sig[i]?.text !== "@" || sig[i + 1]?.kind !== "id") return undefined;
  let k = i + 1;
  let name = sig[k]!.text;
  while (sig[k + 1]?.text === "." && sig[k + 2]?.kind === "id") {
    name += "." + sig[k + 2]!.text;
    k += 2;
  }
  if (sig[k + 1]?.text !== "(") return { at: i, name, open: -1, close: -1, last: k };
  let depth = 0;
  let j = k + 1;
  for (; j < sig.length; j++) {
    if (sig[j]!.text === "(") depth++;
    else if (sig[j]!.text === ")" && --depth === 0) break;
  }
  return j < sig.length ? { at: i, name, open: k + 1, close: j, last: j } : undefined;
}

export function transformSource(source: string, opts: CodemodOptions = {}): CodemodResult {
  const toks = tokenize(source);
  const sig = toks.filter((t) => t.kind !== "ws" && t.kind !== "comment");
  const decls = parseImports(source, sig);
  const edits: Edit[] = [];
  const changes: string[] = [];
  const warnings: CodemodWarning[] = [];
  const warn = (offset: number, message: string) => warnings.push({ line: lineOf(source, offset), message });

  // ---------------------------------------------------------------- class-validator / class-transformer imports
  const targets = decls.filter((d) => SOURCES.has(d.module) && !d.sideEffect);
  const moved: Spec[] = [];
  const movedType: Spec[] = [];
  const keptByModule = new Map<string, Spec[]>();
  const renames = new Map<string, string>(); // unaliased local name -> new name
  const importedLocals = new Map<string, string>(); // imported name -> local name (class-validator/transformer specifiers)
  const namespaces = new Map<string, ImportDecl>();

  for (const d of targets) {
    if (d.namespace) {
      namespaces.set(d.namespace, d);
      edits.push({ start: d.moduleTok.start, end: d.moduleTok.end, text: `${d.quote}dto-kit${d.quote}` });
      changes.push(`import * as ${d.namespace} from "${d.module}" → "dto-kit"`);
      continue;
    }
    if (d.defaultName) warn(d.start, `default import "${d.defaultName}" from "${d.module}" can't be moved automatically`);
    for (const s of d.specs) {
      const target = RENAMES[s.imported] ?? s.imported;
      if (!isAvailable(target)) {
        keptByModule.set(d.module, [...(keptByModule.get(d.module) ?? []), s]);
        warn(d.start, `"${s.imported}" ${unavailableReason(s.imported)}`);
        continue;
      }
      importedLocals.set(s.imported, s.local);
      if (target !== s.imported) {
        changes.push(`renamed ${s.imported} → ${target}`);
        if (s.local === s.imported) renames.set(s.imported, target);
      }
      (d.typeOnly ? movedType : moved).push({ imported: target, local: s.local === s.imported ? target : s.local, isType: s.isType });
    }
  }

  // Replace the first target import with the merged import(s); drop the rest.
  const named = targets.filter((d) => !d.namespace);
  // Nothing movable (only names dto-kit lacks): leave the imports exactly as they are, so a second run changes nothing.
  if (named.length && (moved.length || movedType.length)) {
    const first = named[0]!;
    const style = { quote: first.quote, semi: first.semi };
    const lines: string[] = [];
    const dedupe = (l: Spec[]) => l.filter((s, i) => l.findIndex((x) => x.local === s.local && x.imported === s.imported) === i);
    if (moved.length) lines.push(fmtImport(dedupe(moved), "dto-kit", style));
    if (movedType.length) lines.push(fmtImport(dedupe(movedType), "dto-kit", { ...style, typeOnly: true }));
    for (const [module, specs] of keptByModule) {
      lines.push(`// TODO(dto-kit): not available in dto-kit: ${specs.map((s) => s.imported).join(", ")}`);
      lines.push(fmtImport(specs, module, style));
    }
    const indent = /^[ \t]*/.exec(source.slice(source.lastIndexOf("\n", first.start - 1) + 1))![0];
    edits.push({ start: first.start, end: first.end, text: lines.join("\n" + indent) });
    for (const d of named.slice(1)) {
      const [a, b] = removalRange(source, d);
      edits.push({ start: a, end: b, text: "" });
    }
    if (moved.length || movedType.length) {
      const names = [...moved, ...movedType].map((s) => s.imported);
      changes.unshift(`imports from ${[...new Set(named.map((d) => `"${d.module}"`))].join(" + ")} → "dto-kit" (${names.length} name${names.length === 1 ? "" : "s"})`);
    }
  }

  const importRanges = decls.map((d) => [d.start, d.end] as const);
  const insideImport = (offset: number) => importRanges.some(([a, b]) => offset >= a && offset < b);

  // ---------------------------------------------------------------- identifier renames (IsUrl -> IsURL, ...)
  const uses = new Map<string, number>();
  for (let i = 0; i < sig.length; i++) {
    const t = sig[i]!;
    if (t.kind !== "id" || insideImport(t.start)) continue;
    const after = renames.get(t.text);
    if (after && sig[i - 1]?.text !== ".") {
      edits.push({ start: t.start, end: t.end, text: after });
      uses.set(t.text, (uses.get(t.text) ?? 0) + 1);
    }
    // namespace usage: cv.IsUrl / cv.validate
    const ns = namespaces.get(t.text);
    if (ns && sig[i + 1]?.text === "." && sig[i + 2]?.kind === "id" && sig[i - 1]?.text !== ".") {
      const nameTok = sig[i + 2]!;
      const rename = RENAMES[nameTok.text];
      if (rename) {
        edits.push({ start: nameTok.start, end: nameTok.end, text: rename });
        changes.push(`renamed ${t.text}.${nameTok.text} → ${t.text}.${rename}`);
      } else if (!isAvailable(nameTok.text)) {
        warn(nameTok.start, `"${t.text}.${nameTok.text}" ${unavailableReason(nameTok.text)}`);
      }
    }
  }
  for (const [from, n] of uses) changes.push(`  ${from} → ${renames.get(from)}: ${n} use${n === 1 ? "" : "s"} updated`);

  // ---------------------------------------------------------------- decorator groups (ValidateNested / Type on Map|Set)
  const validateNestedLocal = importedLocals.get("ValidateNested");
  const typeLocal = importedLocals.get("Type");
  for (let i = 0; i < sig.length; i++) {
    if (sig[i]!.text !== "@" || insideImport(sig[i]!.start)) continue;
    const group: Deco[] = [];
    let j = i;
    for (let d = parseDecorator(sig, j); d; d = parseDecorator(sig, j)) {
      group.push(d);
      j = d.last + 1;
    }
    if (!group.length) continue;
    i = j - 1;
    const names = group.map((g) => g.name.split(".").pop()!);
    if (validateNestedLocal) {
      const vn = group.find((g) => g.name === validateNestedLocal);
      if (vn && !names.includes(typeLocal ?? "Type") && !names.includes("Nested")) {
        warn(sig[vn.at]!.start, "@ValidateNested() has no @Type(() => Class): dto-kit builds nested DTOs from plain input and needs the class (class-validator only saw instances)");
      }
    }
    const typeDeco = typeLocal ? group.find((g) => g.name === typeLocal) : undefined;
    if (typeDeco && typeDeco.open !== -1) {
      let k = j;
      while (sig[k] && MODIFIERS.has(sig[k]!.text)) k++;
      if (sig[k]?.kind === "id" && (sig[k + 1]?.text === ":" || ((sig[k + 1]?.text === "?" || sig[k + 1]?.text === "!") && sig[k + 2]?.text === ":"))) {
        const t = sig[k + (sig[k + 1]!.text === ":" ? 2 : 3)];
        if (t && (t.text === "Map" || t.text === "Set")) {
          let depth = 0;
          let comma = false;
          for (let m = typeDeco.open + 1; m < typeDeco.close; m++) {
            const x = sig[m]!.text;
            if (x === "(" || x === "[" || x === "{") depth++;
            else if (x === ")" || x === "]" || x === "}") depth--;
            else if (x === "," && depth === 0) comma = true;
          }
          if (!comma) {
            edits.push({ start: sig[typeDeco.close]!.start, end: sig[typeDeco.close]!.start, text: `, { container: ${t.text} }` });
            changes.push(`@Type on ${sig[k]!.text}: ${t.text}<…> → added { container: ${t.text} } (dto-kit can't read declared types)`);
          } else if (!source.slice(sig[typeDeco.open]!.start, sig[typeDeco.close]!.end).includes("container")) {
            warn(sig[typeDeco.at]!.start, `@Type on ${t.text} field "${sig[k]!.text}": add { container: ${t.text} } to its options`);
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------- class-transformer options dto-kit can't honour
  for (const t of sig) {
    if (t.kind === "id" && t.text === "enableImplicitConversion" && !insideImport(t.start)) {
      warn(t.start, "enableImplicitConversion is not supported (dto-kit can't read declared types): give each field an explicit @Type(() => Number | String | Boolean | Date)");
    }
  }

  // ---------------------------------------------------------------- Nest: ValidationPipe -> DtoKitValidationPipe
  if (opts.nest) {
    for (const d of decls) {
      if (d.module !== "@nestjs/common" || d.namespace) continue;
      const vp = d.specs.find((s) => s.imported === "ValidationPipe");
      if (!vp) continue;
      const rest = d.specs.filter((s) => s !== vp);
      const nestImport = fmtImport([{ imported: "DtoKitValidationPipe", local: vp.local, isType: false }], "dto-kit/nest", { quote: d.quote, semi: d.semi });
      const text = rest.length ? `${fmtImport(rest, d.module, { quote: d.quote, semi: d.semi, typeOnly: d.typeOnly })}\n${nestImport}` : nestImport;
      edits.push({ start: d.start, end: d.end, text });
      changes.push(`ValidationPipe → DtoKitValidationPipe (from "dto-kit/nest"${vp.local !== "ValidationPipe" ? `, as ${vp.local}` : ", imported as ValidationPipe so call sites are unchanged"})`);
      for (const t of sig) {
        if (t.kind === "id" && NEST_UNSUPPORTED.includes(t.text) && !insideImport(t.start)) {
          warn(t.start, `${t.text} is not supported by DtoKitValidationPipe`);
        }
      }
    }
  }

  // ---------------------------------------------------------------- apply
  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  let code = source;
  let lastStart = Infinity;
  for (const e of edits) {
    if (e.end > lastStart) continue; // overlapping edit (a rename inside a range already rewritten): skip
    code = code.slice(0, e.start) + e.text + code.slice(e.end);
    lastStart = e.start;
  }
  warnings.sort((a, b) => a.line - b.line);
  return { code, changed: code !== source, changes, warnings };
}
