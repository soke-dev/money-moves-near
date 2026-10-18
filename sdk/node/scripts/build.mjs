// Builds both flavours: ES modules for import, CommonJS for require.
import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
execSync("npx tsc -p tsconfig.json", { stdio: "inherit" });
execSync("npx tsc -p tsconfig.cjs.json", { stdio: "inherit" });
// Each folder says what it is, so Node reads the files right whichever way they're loaded.
mkdirSync("dist/cjs", { recursive: true });
writeFileSync("dist/cjs/package.json", JSON.stringify({ type: "commonjs" }) + "\n");
writeFileSync("dist/esm/package.json", JSON.stringify({ type: "module" }) + "\n");
console.log("built dist/esm and dist/cjs");
