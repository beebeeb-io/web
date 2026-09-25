// CI wiring guard for the full-stack E2E job (flow "GitHub presence & docs", issue 5).
//
// beebeeb-io/server is a PRIVATE repo. The E2E job used to fetch it with an
// anonymous `git clone https://github.com/beebeeb-io/server.git`, which fails on
// every run ("could not read Username for 'https://github.com'"), and
// `continue-on-error: true` kept the CI badge green while zero browser tests ran.
//
// These assertions pin the fix:
//   - the server is checked out with a read-only deploy key held as a secret,
//   - no step clones the server anonymously,
//   - core is pinned to the server's CORE_REV (not whatever core main is today),
//   - fork PRs (which never receive secrets) skip the job with a visible notice,
//   - a same-repo run without the secret fails loudly instead of silently skipping.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Step = { name?: string; uses?: string; run?: string; with?: Record<string, string>; if?: string };
type Job = {
  name?: string;
  needs?: string | string[];
  if?: string;
  "continue-on-error"?: boolean;
  outputs?: Record<string, string>;
  steps: Step[];
};

const ci = Bun.YAML.parse(
  readFileSync(join(import.meta.dir, "..", ".github", "workflows", "ci.yml"), "utf8"),
) as { jobs: Record<string, Job> };

const e2e = ci.jobs.e2e;
const gate = ci.jobs["e2e-gate"];

describe("CI E2E job: private server checkout", () => {
  test("no step clones the private server repo anonymously", () => {
    const runs = Object.values(ci.jobs).flatMap((j) => j.steps.map((s) => s.run ?? ""));
    const anonymous = runs.filter((r) => /git clone[^\n]*github\.com\/beebeeb-io\/server/.test(r));
    expect(anonymous).toEqual([]);
  });

  test("server is checked out via actions/checkout with the read-only deploy key", () => {
    const step = e2e.steps.find((s) => s.with?.repository === "beebeeb-io/server");
    expect(step).toBeDefined();
    expect(step!.uses).toMatch(/^actions\/checkout@[0-9a-f]{40}/);
    expect(step!.with!["ssh-key"]).toBe("${{ secrets.SERVER_DEPLOY_KEY }}");
    expect(step!.with!.path).toBe("server");
    expect(step!.with!["persist-credentials"]).toBe(false);
  });

  test("core is pinned to the server's CORE_REV", () => {
    const pin = e2e.steps.find((s) => (s.run ?? "").includes("CORE_REV"));
    expect(pin).toBeDefined();
    expect(pin!.run).toContain("server/CORE_REV");
    expect(pin!.run).toMatch(/rev-parse HEAD\)" = "\$CORE_REV"/);
  });

  test("a gate job decides whether E2E can run, and the E2E job depends on it", () => {
    expect(gate).toBeDefined();
    expect(gate.outputs?.run).toBeDefined();
    expect(e2e.needs).toBe("e2e-gate");
    expect(e2e.if).toBe("needs.e2e-gate.outputs.run == 'true'");
  });

  test("fork PRs skip with a visible notice; a missing secret on this repo fails loudly", () => {
    const script = gate.steps.map((s) => s.run ?? "").join("\n");
    expect(script).toContain("::notice");
    expect(script).toContain("::error");
    expect(script).toMatch(/exit 1/);
    // The gate itself must not be allowed to fail silently.
    expect(gate["continue-on-error"]).toBeUndefined();
  });
});
