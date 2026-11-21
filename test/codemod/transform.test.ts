import { describe, expect, it } from "vitest";
import { transformSource } from "../../src/codemod/index.js";

const t = (src: string, nest = false) => transformSource(src, { nest });

describe("codemod: imports", () => {
  it("swaps the module, keeping quote and semicolon style", () => {
    expect(t(`import { IsString, IsEmail } from 'class-validator';\n`).code).toBe(`import { IsString, IsEmail } from 'dto-kit';\n`);
    expect(t(`import { IsString } from "class-validator"\n`).code).toBe(`import { IsString } from "dto-kit"\n`);
  });

  it("merges class-validator and class-transformer imports into one, removing the other line cleanly", () => {
    const r = t(`import { IsString } from 'class-validator';\nimport { Type, Expose } from 'class-transformer';\n\nclass A {}\n`);
    expect(r.code).toBe(`import { IsString, Type, Expose } from 'dto-kit';\n\nclass A {}\n`);
    expect(r.changed).toBe(true);
  });

  it("keeps aliases and inline type modifiers; moves `import type` to `import type`", () => {
    const r = t(`import { IsString as S, type ValidationOptions } from 'class-validator';\nimport type { ClassTransformOptions } from 'class-transformer';\n`);
    expect(r.code).toBe(`import { IsString as S, type ValidationOptions } from 'dto-kit';\nimport type { ClassTransformOptions } from 'dto-kit';\n`);
  });

  it("handles multi-line imports and wraps long results", () => {
    const names = ["IsString", "IsEmail", "IsOptional", "IsInt", "Min", "Max", "Length", "Matches", "IsEnum", "ValidateNested", "IsArray", "IsBoolean"];
    const r = t(`import {\n  ${names.join(",\n  ")},\n} from 'class-validator';\n`);
    expect(r.code.startsWith("import {\n  IsString,\n")).toBe(true);
    expect(r.code.trimEnd().endsWith("} from 'dto-kit';")).toBe(true);
    expect(r.code).not.toContain("class-validator");
  });

  it("keeps names dto-kit doesn't have on the old import, with a TODO and a warning", () => {
    const r = t(`import { IsString, IsEmpty, validate } from 'class-validator';\n`);
    expect(r.code).toBe(
      `import { IsString } from 'dto-kit';\n// TODO(dto-kit): not available in dto-kit: IsEmpty, validate\nimport { IsEmpty, validate } from 'class-validator';\n`,
    );
    expect(r.warnings.map((w) => w.message)).toEqual([
      expect.stringContaining('"IsEmpty"'),
      expect.stringContaining('"validate"'),
    ]);
    expect(r.warnings[0]!.line).toBe(1);
  });

  it("a file with only unavailable names is left alone (just warned about)", () => {
    const src = `import { IsEmpty, validate } from 'class-validator';\n`;
    const r = t(src);
    expect(r.code).toBe(src);
    expect(r.changed).toBe(false);
    expect(r.warnings).toHaveLength(2);
  });

  it("is idempotent", () => {
    const once = t(`import { IsString, IsUrl, IsEmpty } from 'class-validator';\n@IsUrl() u: string;\n`).code;
    const twice = t(once);
    expect(twice.changed).toBe(false);
    expect(twice.code).toBe(once);
  });

  it("leaves files without these imports byte-for-byte alone", () => {
    const src = `import { Injectable } from '@nestjs/common';\nconst x = 'class-validator';\n`;
    const r = t(src);
    expect(r.changed).toBe(false);
    expect(r.code).toBe(src);
  });

  it("ignores side-effect imports, dynamic imports and strings/comments that mention the package", () => {
    const src = `import 'class-validator';\nconst m = await import('class-validator');\n// import { A } from 'class-validator';\nconst s = "import { A } from 'class-validator'";\n`;
    expect(t(src).code).toBe(src);
  });

  it("works with CRLF line endings", () => {
    const r = t(`import { IsString } from 'class-validator';\r\nimport { Expose } from 'class-transformer';\r\nclass X {}\r\n`);
    expect(r.code).toBe(`import { IsString, Expose } from 'dto-kit';\r\nclass X {}\r\n`);
  });

  it("rewrites a namespace import and checks its usages", () => {
    const r = t(`import * as cv from 'class-validator';\nclass A { @cv.IsUrl() u: string; @cv.IsString() s: string; @cv.IsEmpty() e: string; }\ncv.validate(x);\n`);
    expect(r.code).toContain(`import * as cv from 'dto-kit';`);
    expect(r.code).toContain("@cv.IsURL()");
    expect(r.warnings.map((w) => w.message)).toEqual([expect.stringContaining('"cv.IsEmpty"'), expect.stringContaining('"cv.validate"')]);
  });
});

describe("codemod: renames", () => {
  it("renames IsUrl, IsNumberString and IsDateString everywhere they are used", () => {
    const r = t(`import { IsUrl, IsNumberString, IsDateString } from 'class-validator';\nclass A {\n  @IsUrl() a: string;\n  @IsNumberString() b: string;\n  @IsDateString() c: string;\n  @IsUrl({ require_tld: false }) d: string;\n}\n`);
    expect(r.code).toContain("import { IsURL, IsNumericString, IsISO8601 } from 'dto-kit';");
    expect(r.code).toContain("@IsURL() a");
    expect(r.code).toContain("@IsNumericString() b");
    expect(r.code).toContain("@IsISO8601() c");
    expect(r.code).toContain("@IsURL({ require_tld: false }) d");
    expect(r.code).not.toMatch(/IsUrl|IsNumberString|IsDateString/);
  });

  it("leaves usages alone when the import is aliased", () => {
    const r = t(`import { IsUrl as U } from 'class-validator';\nclass A { @U() a: string; }\n`);
    expect(r.code).toBe(`import { IsURL as U } from 'dto-kit';\nclass A { @U() a: string; }\n`);
  });

  it("does not touch strings, comments, template text, regexes or property accesses", () => {
    const src = `import { IsUrl } from 'class-validator';
// IsUrl is great
const a = 'IsUrl';
const b = \`IsUrl \${1}\`;
const c = /IsUrl'/;
const d = other.IsUrl;
class A { @IsUrl() u: string; }
`;
    const r = t(src).code;
    expect(r).toContain("// IsUrl is great");
    expect(r).toContain("const a = 'IsUrl';");
    expect(r).toContain("`IsUrl ${1}`");
    expect(r).toContain("/IsUrl'/");
    expect(r).toContain("other.IsUrl");
    expect(r).toContain("@IsURL() u");
  });

  it("a regex containing quotes does not confuse the scanner", () => {
    const r = t(`import { Matches, IsUrl } from 'class-validator';\nclass A { @Matches(/^[a-z' "]+$/i) a: string; @IsUrl() b: string; }\n`);
    expect(r.code).toContain(`@Matches(/^[a-z' "]+$/i) a`);
    expect(r.code).toContain("@IsURL() b");
  });
});

describe("codemod: decorator checks", () => {
  const head = `import { ValidateNested } from 'class-validator';\nimport { Type } from 'class-transformer';\n`;

  it("warns on @ValidateNested() without @Type", () => {
    const r = t(`${head}class A {\n  @ValidateNested()\n  b: B;\n}\n`);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]!.message).toContain("@ValidateNested() has no @Type");
    expect(r.warnings[0]!.line).toBe(4);
  });

  it("does not warn when @Type is in the same decorator group (either order, any line layout)", () => {
    expect(t(`${head}class A {\n  @ValidateNested() @Type(() => B)\n  b: B;\n}\n`).warnings).toHaveLength(0);
    expect(t(`${head}class A {\n  @Type(() => B)\n  @ValidateNested({ each: true })\n  b: B[];\n}\n`).warnings).toHaveLength(0);
  });

  it("adds { container } to @Type on Map / Set fields", () => {
    const r = t(`import { Type } from 'class-transformer';\nclass A {\n  @Type(() => W)\n  weapons: Map<string, W>;\n  @Type(() => W) private readonly set?: Set<W>;\n  @Type(() => W)\n  list: W[];\n}\n`);
    expect(r.code).toContain("@Type(() => W, { container: Map })\n  weapons");
    expect(r.code).toContain("@Type(() => W, { container: Set }) private readonly set?");
    expect(r.code).toContain("@Type(() => W)\n  list: W[];");
    expect(r.changes.some((c) => c.includes("container: Map"))).toBe(true);
  });

  it("warns instead of editing when @Type already has options", () => {
    const r = t(`import { Type } from 'class-transformer';\nclass A {\n  @Type(() => W, { keepDiscriminatorProperty: true })\n  m: Map<string, W>;\n}\n`);
    expect(r.code).toContain("keepDiscriminatorProperty: true })");
    expect(r.code).not.toContain("container:");
    expect(r.warnings[0]!.message).toContain("container: Map");
  });

  it("warns about enableImplicitConversion", () => {
    const r = t(`import { plainToInstance } from 'class-transformer';\nplainToInstance(A, x, { enableImplicitConversion: true });\n`);
    expect(r.warnings.map((w) => w.message).join()).toContain("enableImplicitConversion");
  });
});

describe("codemod: --nest", () => {
  const src = `import { Body, Controller, ValidationPipe } from '@nestjs/common';\nconst p = new ValidationPipe({ whitelist: true, forbidUnknownValues: false });\n`;

  it("swaps ValidationPipe for DtoKitValidationPipe, keeping the local name", () => {
    const r = t(src, true);
    expect(r.code).toBe(`import { Body, Controller } from '@nestjs/common';\nimport { DtoKitValidationPipe as ValidationPipe } from 'dto-kit/nest';\nconst p = new ValidationPipe({ whitelist: true, forbidUnknownValues: false });\n`);
    expect(r.warnings.map((w) => w.message)).toEqual([expect.stringContaining("forbidUnknownValues")]);
  });

  it("drops the @nestjs/common import entirely when ValidationPipe was its only name", () => {
    expect(t(`import { ValidationPipe } from '@nestjs/common';\n`, true).code).toBe(`import { DtoKitValidationPipe as ValidationPipe } from 'dto-kit/nest';\n`);
  });

  it("is off by default", () => {
    expect(t(src).changed).toBe(false);
  });
});
