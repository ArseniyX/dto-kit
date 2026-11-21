import { defineConfig } from "tsup";
// Declarations are emitted by `tsc -p tsconfig.build.json` (tsup's dts bundler needs the TS compiler API, which TS 7 lacks).
export default defineConfig({
  entry: ["src/index.ts", "src/nest.ts", "src/codemod/index.ts", "src/codemod/cli.ts"],
  format: ["esm", "cjs"],
  dts: false,
  clean: true,
  target: "es2022",
});
