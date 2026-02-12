/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const cwd = process.cwd();
const args = new Set(process.argv.slice(2));
const forceProd = args.has("--prod");
const isProd = forceProd || process.env.NODE_ENV === "production";

function loadEnvFile(file) {
  const fullPath = path.join(cwd, file);
  if (fs.existsSync(fullPath)) {
    dotenv.config({ path: fullPath, override: false, quiet: true });
  }
}

function hasValue(key) {
  const value = process.env[key];
  return typeof value === "string" && value.trim().length > 0;
}

function getValue(key) {
  return process.env[key]?.trim() || "";
}

function isTruthy(key) {
  return getValue(key).toLowerCase() === "true";
}

function checkUrlHttps(key, errors) {
  const value = getValue(key);
  if (!value) return;
  if (!value.startsWith("https://")) {
    errors.push(`${key} must use https in production`);
  }
}

function checkMinLength(key, minLength, errors) {
  const value = getValue(key);
  if (!value) return;
  if (value.length < minLength) {
    errors.push(`${key} is too short (min ${minLength} chars)`);
  }
}

function main() {
  // Local files first, then environment (environment still wins because override=false).
  loadEnvFile(".env");
  loadEnvFile(".env.local");

  const errors = [];
  const warnings = [];

  const requiredCommon = [
    "HUBSPOT_ACCESS_TOKEN",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "NEXTAUTH_SECRET",
    "ALLOWED_EMAIL_DOMAIN",
  ];

  const requiredProdOnly = [
    "NEXTAUTH_URL",
    "DEPLOYMENT_WEBHOOK_SECRET",
  ];

  const recommended = [
    "API_SECRET_TOKEN",
    "AUTH_TOKEN_SECRET",
    "AUTH_SALT",
  ];

  for (const key of requiredCommon) {
    if (!hasValue(key)) errors.push(`Missing required env: ${key}`);
  }

  if (isProd) {
    for (const key of requiredProdOnly) {
      if (!hasValue(key)) errors.push(`Missing required production env: ${key}`);
    }
  }

  for (const key of recommended) {
    if (!hasValue(key)) warnings.push(`Recommended env not set: ${key}`);
  }

  if (isProd) {
    checkMinLength("NEXTAUTH_SECRET", 32, errors);
    checkMinLength("DEPLOYMENT_WEBHOOK_SECRET", 24, errors);
    checkUrlHttps("NEXTAUTH_URL", errors);
    if (isTruthy("DEBUG_API_ENABLED")) {
      errors.push("DEBUG_API_ENABLED must be false in production");
    }
    if (isTruthy("ENABLE_ADMIN_ROLE_RECOVERY")) {
      errors.push("ENABLE_ADMIN_ROLE_RECOVERY must be false in production");
    }
  } else {
    if (isTruthy("DEBUG_API_ENABLED")) {
      warnings.push("DEBUG_API_ENABLED is enabled (ensure this is never true in production)");
    }
    if (isTruthy("ENABLE_ADMIN_ROLE_RECOVERY")) {
      warnings.push("ENABLE_ADMIN_ROLE_RECOVERY is enabled (ensure this is never true in production)");
    }
  }

  const modeLabel = isProd ? "production" : "development";
  console.log(`Preflight mode: ${modeLabel}`);

  if (errors.length === 0) {
    console.log("[OK] Required checks passed");
  } else {
    console.log("[FAIL] Required checks failed:");
    for (const err of errors) console.log(`  - ${err}`);
  }

  if (warnings.length > 0) {
    console.log("Warnings:");
    for (const warning of warnings) console.log(`  - ${warning}`);
  }

  process.exit(errors.length === 0 ? 0 : 1);
}

main();
