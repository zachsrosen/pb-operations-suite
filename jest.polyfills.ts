// This file runs BEFORE the test environment is set up (setupFiles, not setupFilesAfterEnv)
// It polyfills globals needed by undici and next/server

/* eslint-disable @typescript-eslint/no-require-imports */
const util = require("util");

Object.assign(globalThis, {
  TextEncoder: util.TextEncoder,
  TextDecoder: util.TextDecoder,
});
