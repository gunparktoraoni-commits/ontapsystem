import fs from "node:fs";
import path from "node:path";

const TAG = "[HOSTINGER_BUILD]";
const nextDir = path.join(process.cwd(), ".next");
const buildIdPath = path.join(nextDir, "BUILD_ID");
const chunksDir = path.join(nextDir, "static", "chunks");

function fail(message) {
  console.error(`${TAG} ${message}`);
  process.exit(1);
}

function ok(message) {
  console.log(`${TAG} ${message}`);
}

if (!fs.existsSync(nextDir)) {
  fail("Missing .next directory — run npm run build first.");
}

if (!fs.existsSync(buildIdPath)) {
  fail("Missing .next/BUILD_ID — build output is incomplete.");
}

const buildId = fs.readFileSync(buildIdPath, "utf8").trim();
if (!buildId) {
  fail(".next/BUILD_ID is empty.");
}
ok(`BUILD_ID=${buildId}`);

if (!fs.existsSync(chunksDir)) {
  fail("Missing .next/static/chunks/ — static JS chunks were not emitted.");
}

const chunkFiles = fs
  .readdirSync(chunksDir)
  .filter((name) => name.endsWith(".js"));

if (chunkFiles.length === 0) {
  fail(".next/static/chunks/ contains no .js files.");
}
ok(`Found ${chunkFiles.length} chunk file(s) in .next/static/chunks/`);

const sampleSize = Math.min(5, chunkFiles.length);
for (let i = 0; i < sampleSize; i += 1) {
  const filePath = path.join(chunksDir, chunkFiles[i]);
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size === 0) {
    fail(`Chunk file is missing or empty: ${chunkFiles[i]}`);
  }
}
ok(`Sampled ${sampleSize} chunk file(s) — all present and non-empty.`);

ok("Build verification passed.");
