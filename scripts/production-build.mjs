import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Hostinger and other hosts often inject a non-standard NODE_ENV (e.g. "staging")
 * or load NODE_ENV=development from .env. Next.js 16 fails prerendering
 * /_global-error when NODE_ENV is not "production" during `next build`.
 */
const existingNodeOptions = process.env.NODE_OPTIONS?.trim() ?? "";
const heapFlag = "--max-old-space-size=8192";
/** Hostinger shared Linux often ships glibc < 2.29; native @next/swc-linux-x64-gnu then fails. */
const hostingerLikeBuild =
  process.env.HOSTINGER_BUILD === "1" ||
  process.env.USE_WEBPACK_BUILD === "1" ||
  (process.platform === "linux" && process.env.CI !== "true");

const env = {
  ...process.env,
  NODE_ENV: "production",
  NODE_OPTIONS: existingNodeOptions.includes("--max-old-space-size")
    ? existingNodeOptions
    : `${existingNodeOptions} ${heapFlag}`.trim(),
};

const nextBuildArgs = ["next", "build"];
if (hostingerLikeBuild) {
  nextBuildArgs.push("--webpack");
}

const nextDir = path.join(process.cwd(), ".next");
if (fs.existsSync(nextDir)) {
  fs.rmSync(nextDir, { recursive: true, force: true });
}

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(command, nextBuildArgs, {
  stdio: "inherit",
  env,
  shell: true,
});

if ((result.status ?? 1) !== 0) {
  process.exit(result.status ?? 1);
}

const verify = spawnSync(process.execPath, ["scripts/verify-next-build.mjs"], {
  stdio: "inherit",
  env,
});

process.exit(verify.status ?? 1);
