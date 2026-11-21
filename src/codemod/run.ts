import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { transformSource } from "./transform.js";

const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", ".git", ".next", ".turbo", ".generated"]);
const EXTS = new Set([".ts", ".tsx", ".mts", ".cts"]);

export const USAGE = `dto-kit-codemod: move a project from class-validator / class-transformer to dto-kit

  dto-kit-codemod [paths...] [--write] [--nest] [--check]

  paths     files or directories to scan (default: .)
  --write   apply the changes (the default is a dry run that only reports)
  --nest    also swap Nest's ValidationPipe for dto-kit/nest's DtoKitValidationPipe
  --check   exit with status 1 if any file would change (for CI); implies a dry run
`;

function* walk(path: string): Generator<string> {
  const st = statSync(path);
  if (st.isFile()) {
    if (EXTS.has(extname(path)) && !path.endsWith(".d.ts")) yield path;
    return;
  }
  for (const name of readdirSync(path).sort()) {
    if (SKIP_DIRS.has(name)) continue;
    yield* walk(join(path, name));
  }
}

export interface RunResult {
  exitCode: number;
  changedFiles: string[];
  warningCount: number;
}

export function run(argv: string[], log: (line: string) => void = console.log, cwd = process.cwd()): RunResult {
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const unknown = [...flags].filter((f) => !["--write", "--nest", "--check", "--help"].includes(f));
  if (flags.has("--help") || unknown.length) {
    if (unknown.length) log(`unknown option: ${unknown.join(", ")}`);
    log(USAGE);
    return { exitCode: unknown.length ? 2 : 0, changedFiles: [], warningCount: 0 };
  }
  const write = flags.has("--write") && !flags.has("--check");
  const paths = argv.filter((a) => !a.startsWith("--"));
  const changedFiles: string[] = [];
  let warningCount = 0;
  let scanned = 0;

  for (const p of paths.length ? paths : ["."]) {
    for (const file of walk(resolve(cwd, p))) {
      scanned++;
      const source = readFileSync(file, "utf8");
      if (!/class-validator|class-transformer|@nestjs\/common/.test(source)) continue;
      const result = transformSource(source, { nest: flags.has("--nest") });
      const rel = relative(cwd, file) || file;
      if (!result.changed && !result.warnings.length) continue;
      if (result.changed) {
        changedFiles.push(rel);
        log(`${write ? "updated" : "would update"} ${rel}`);
        for (const c of result.changes) log(`    ${c.startsWith("  ") ? c.trim().padStart(c.trim().length + 2) : c}`);
        if (write) writeFileSync(file, result.code);
      }
      for (const w of result.warnings) {
        warningCount++;
        log(`  ${rel}:${w.line}  warning: ${w.message}`);
      }
    }
  }
  log(`\n${scanned} file${scanned === 1 ? "" : "s"} scanned, ${changedFiles.length} ${write ? "updated" : "to update"}, ${warningCount} warning${warningCount === 1 ? "" : "s"}.`);
  if (changedFiles.length && !write) log(flags.has("--check") ? "" : "Dry run: nothing was written. Re-run with --write to apply.");
  return { exitCode: flags.has("--check") && changedFiles.length ? 1 : 0, changedFiles, warningCount };
}
