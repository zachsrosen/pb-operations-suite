#!/usr/bin/env npx tsx

/**
 * Export a stratified product-matching truth set from /api/products/comparison/truth-set.
 *
 * Usage:
 *   npx tsx scripts/export-product-truth-set.ts --url https://app.example.com --size 400
 *
 * Auth:
 *   Provide API_SECRET_TOKEN via env or --token.
 */

import fs from "node:fs/promises";
import path from "node:path";

interface ParsedArgs {
  url: string;
  token: string;
  size: number;
  seed: number;
  outPath: string;
  maxSuggestions: number;
  onlyMismatches: boolean;
  includeNoSuggestion: boolean;
  minScore: number;
}

function parseIntArg(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseNumberArg(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBooleanArg(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes"].includes(normalized)) return true;
  if (["0", "false", "no"].includes(normalized)) return false;
  return fallback;
}

function resolveDefaults(): ParsedArgs {
  const argv = process.argv.slice(2);
  let url = process.env.APP_URL || "http://localhost:3000";
  let token = process.env.API_SECRET_TOKEN || "";
  let size = 300;
  let seed = 42;
  let outPath = "";
  let maxSuggestions = 5;
  let onlyMismatches = true;
  let includeNoSuggestion = true;
  let minScore = 0;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--url" && next) {
      url = next;
      i += 1;
    } else if (arg === "--token" && next) {
      token = next;
      i += 1;
    } else if (arg === "--size" && next) {
      size = parseIntArg(next, size);
      i += 1;
    } else if (arg === "--seed" && next) {
      seed = parseIntArg(next, seed);
      i += 1;
    } else if (arg === "--out" && next) {
      outPath = next;
      i += 1;
    } else if (arg === "--max-suggestions" && next) {
      maxSuggestions = parseIntArg(next, maxSuggestions);
      i += 1;
    } else if (arg === "--only-mismatches" && next) {
      onlyMismatches = parseBooleanArg(next, onlyMismatches);
      i += 1;
    } else if (arg === "--include-no-suggestion" && next) {
      includeNoSuggestion = parseBooleanArg(next, includeNoSuggestion);
      i += 1;
    } else if (arg === "--min-score" && next) {
      minScore = parseNumberArg(next, minScore);
      i += 1;
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const defaultPath = path.join("docs", "data", `product-truth-set-${today}.json`);

  return {
    url: url.replace(/\/$/, ""),
    token,
    size: Math.max(25, Math.min(1000, size)),
    seed: Math.max(1, seed),
    outPath: outPath || defaultPath,
    maxSuggestions: Math.max(1, Math.min(10, maxSuggestions)),
    onlyMismatches,
    includeNoSuggestion,
    minScore: Math.max(0, Math.min(1, minScore)),
  };
}

async function main(): Promise<void> {
  const args = resolveDefaults();

  if (!args.token) {
    throw new Error("API_SECRET_TOKEN env var or --token is required");
  }

  const url = new URL(`${args.url}/api/products/comparison/truth-set`);
  url.searchParams.set("size", String(args.size));
  url.searchParams.set("seed", String(args.seed));
  url.searchParams.set("maxSuggestions", String(args.maxSuggestions));
  url.searchParams.set("onlyMismatches", String(args.onlyMismatches));
  url.searchParams.set("includeNoSuggestion", String(args.includeNoSuggestion));
  url.searchParams.set("minScore", String(args.minScore));

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${args.token}`,
      Accept: "application/json",
    },
  });

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(`Truth-set export failed (${response.status}): ${JSON.stringify(payload)}`);
  }

  await fs.mkdir(path.dirname(args.outPath), { recursive: true });
  await fs.writeFile(args.outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  const selectedCount =
    payload && typeof payload === "object" && payload !== null && "sample" in payload
      ? Number((payload as { sample?: { selectedCount?: number } }).sample?.selectedCount || 0)
      : 0;

  console.log(`Exported truth set to ${args.outPath} (${selectedCount} samples)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
