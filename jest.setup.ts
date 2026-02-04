import "@testing-library/jest-dom";

// Polyfill Web APIs not available in jsdom (needed by next/server for API route tests)
import { Request, Response, Headers, fetch } from "undici";

Object.defineProperties(globalThis, {
  Request: { value: Request, writable: true },
  Response: { value: Response, writable: true },
  Headers: { value: Headers, writable: true },
  fetch: { value: fetch, writable: true },
});
