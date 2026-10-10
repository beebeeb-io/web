// 1884: bunfig.toml roots `bun test` at test/ (0740b, keeps Playwright e2e specs
// out), so packages/shared/**/*.test.ts (telemetry scrubber: IPs, emails, share
// keys) never ran in `bun test` or CI. Bun cannot take a second root, so this
// file imports every shared test file; new ones are picked up by the glob.
import { resolve } from "node:path";

const sharedRoot = resolve(import.meta.dir, "../packages/shared");
const files = [...new Bun.Glob("**/*.test.{ts,tsx}").scanSync({ cwd: sharedRoot })].sort();
if (files.length === 0) throw new Error("no packages/shared tests found; glob is broken");
for (const f of files) await import(resolve(sharedRoot, f));
