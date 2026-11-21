import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../../src/codemod/run.js";

const dir = join(process.cwd(), "test/codemod/.tmp-cli");
const file = (p: string, body: string) => {
  mkdirSync(join(dir, p, ".."), { recursive: true });
  writeFileSync(join(dir, p), body);
};
const out = () => {
  const lines: string[] = [];
  return { lines, log: (l: string) => lines.push(l) };
};

beforeEach(() => {
  rmSync(dir, { recursive: true, force: true });
  file("src/a.dto.ts", `import { IsUrl } from 'class-validator';\nclass A { @IsUrl() u: string; }\n`);
  file("src/b.ts", `export const x = 1;\n`);
  file("node_modules/pkg/c.ts", `import { IsUrl } from 'class-validator';\n`);
  file("src/types.d.ts", `import { IsUrl } from 'class-validator';\n`);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("dto-kit-codemod CLI", () => {
  it("is a dry run by default: reports, writes nothing", () => {
    const { lines, log } = out();
    const r = run(["src"], log, dir);
    expect(r.changedFiles).toEqual(["src/a.dto.ts"]);
    expect(readFileSync(join(dir, "src/a.dto.ts"), "utf8")).toContain("class-validator");
    expect(lines.join("\n")).toContain("would update src/a.dto.ts");
    expect(lines.join("\n")).toContain("Dry run");
  });

  it("--write applies the change", () => {
    run(["src", "--write"], out().log, dir);
    expect(readFileSync(join(dir, "src/a.dto.ts"), "utf8")).toBe(`import { IsURL } from 'dto-kit';\nclass A { @IsURL() u: string; }\n`);
  });

  it("skips node_modules and .d.ts files", () => {
    const r = run([".", "--write"], out().log, dir);
    expect(r.changedFiles).toEqual(["src/a.dto.ts"]);
    expect(readFileSync(join(dir, "node_modules/pkg/c.ts"), "utf8")).toContain("class-validator");
    expect(readFileSync(join(dir, "src/types.d.ts"), "utf8")).toContain("class-validator");
  });

  it("--check exits 1 when something would change, and never writes", () => {
    const r = run(["src", "--check", "--write"], out().log, dir);
    expect(r.exitCode).toBe(1);
    expect(readFileSync(join(dir, "src/a.dto.ts"), "utf8")).toContain("class-validator");
  });

  it("--check exits 0 once migrated", () => {
    run(["src", "--write"], out().log, dir);
    expect(run(["src", "--check"], out().log, dir).exitCode).toBe(0);
  });

  it("reports warnings with file:line", () => {
    file("src/w.ts", `import { IsEmpty } from 'class-validator';\n`);
    const { lines, log } = out();
    const r = run(["src"], log, dir);
    expect(r.warningCount).toBe(1);
    expect(lines.join("\n")).toMatch(/src\/w\.ts:1 {2}warning: "IsEmpty"/);
  });

  it("rejects unknown options", () => {
    expect(run(["--nope"], out().log, dir).exitCode).toBe(2);
  });
});
