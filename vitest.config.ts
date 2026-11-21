import { defineConfig } from "vitest/config";
import { transform } from "esbuild";

// Vite 8's default (Oxc) transformer does not lower TC39 standard decorators yet.
// Pre-transform TS with esbuild, which does.
export default defineConfig({
  // lets codemod output (which imports "dto-kit") run against the sources
  resolve: { alias: [{ find: /^dto-kit\/nest$/, replacement: new URL("./src/nest.ts", import.meta.url).pathname }, { find: /^dto-kit$/, replacement: new URL("./src/index.ts", import.meta.url).pathname }] },
  plugins: [
    {
      name: "esbuild-decorators",
      enforce: "pre",
      async transform(code, id) {
        if (!/\.ts$/.test(id) || id.includes("node_modules")) return;
        // class-transformer's specs were written for TypeScript's legacy field semantics (a declared-but-unassigned
        // field does not exist on the instance), so compile test/ct without [[Define]] fields.
        const legacyFields = id.includes("/test/ct/");
        // test/legacy is compiled like a NestJS project: experimentalDecorators (decorators get (target, key) arguments)
        const experimental = id.includes("/test/legacy/");
        const out = await transform(code, {
          loader: "ts", target: "es2022", sourcemap: true, sourcefile: id,
          ...(experimental
            ? { tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } } }
            : legacyFields ? { tsconfigRaw: { compilerOptions: { useDefineForClassFields: false } } } : {}),
        });
        return { code: out.code, map: out.map };
      },
    },
  ],
});
