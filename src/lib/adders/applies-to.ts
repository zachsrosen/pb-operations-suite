import type { AppliesToContext } from "./types";

type Op = "==" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not in";
export type ParsedAppliesTo = {
  lhs: "shop" | "deal.dealType" | "deal.valueCents" | "now";
  op: Op;
  rhs: string | number | boolean | Date | string[];
};

const LHS_IDENTIFIERS = new Set(["shop", "deal.dealType", "deal.valueCents", "now"]);
const OPS: Op[] = ["<=", ">=", "!=", "==", "<", ">", "not in", "in"];

/** Phase 1 parser: single predicate, no combinators. */
export function parseAppliesTo(input: string): ParsedAppliesTo {
  if (!input || !input.trim()) throw new Error("empty appliesTo expression");

  // Reject boolean combinators explicitly.
  if (/&&|\|\|/.test(input)) {
    throw new Error("boolean combinators (&&, ||) are not supported in Phase 1");
  }
  if (/===|!==/.test(input)) {
    throw new Error("use ==/!= not ===/!==");
  }

  // Try ops in length-desc order so "<=" matches before "<".
  for (const op of OPS) {
    const idx = findOp(input, op);
    if (idx >= 0) {
      const lhsRaw = input.slice(0, idx).trim();
      const rhsRaw = input.slice(idx + op.length).trim();
      if (!LHS_IDENTIFIERS.has(lhsRaw)) {
        throw new Error(`LHS must be one of: ${[...LHS_IDENTIFIERS].join(", ")}`);
      }
      const rhs = parseRhs(rhsRaw, lhsRaw, op);
      return { lhs: lhsRaw as ParsedAppliesTo["lhs"], op, rhs };
    }
  }
  throw new Error(`no recognized operator in: ${input}`);
}

function findOp(input: string, op: Op): number {
  // Find op token not inside quotes or brackets.
  let inString = false;
  let bracket = 0;
  for (let i = 0; i <= input.length - op.length; i++) {
    const c = input[i];
    if (c === "'") inString = !inString;
    else if (c === "[") bracket++;
    else if (c === "]") bracket--;
    if (!inString && bracket === 0 && input.startsWith(op, i)) {
      // ensure it's whole-token for in / not in
      if (op === "in" || op === "not in") {
        const before = i > 0 ? input[i - 1] : " ";
        const after = input[i + op.length] ?? " ";
        if (/\w/.test(before) || /\w/.test(after)) continue;
      }
      return i;
    }
  }
  return -1;
}

function parseRhs(raw: string, lhs: string, op: Op): ParsedAppliesTo["rhs"] {
  if (op === "in" || op === "not in") {
    const m = raw.match(/^\[\s*(.*?)\s*\]$/);
    if (!m) throw new Error(`expected list literal for '${op}'`);
    const inner = m[1].trim();
    if (inner === "") return [];
    return inner.split(",").map((s) => stripQuotes(s.trim()));
  }
  // String literal
  if (raw.startsWith("'") && raw.endsWith("'")) {
    const s = raw.slice(1, -1);
    // If LHS is `now`, coerce to Date.
    if (lhs === "now") return new Date(s);
    return s;
  }
  // Boolean
  if (raw === "true" || raw === "false") return raw === "true";
  // Number
  const n = Number(raw);
  if (!Number.isNaN(n)) return n;
  throw new Error(`could not parse RHS: ${raw}`);
}

function stripQuotes(s: string): string {
  if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1);
  return s;
}

/** Evaluate an `appliesTo` expression against context. Null/empty → true (unconditional). */
export function evaluateAppliesTo(
  expr: string | null | undefined,
  ctx: AppliesToContext
): boolean {
  if (!expr || !expr.trim()) return true;
  const parsed = parseAppliesTo(expr);
  const lhsValue = resolveLhs(parsed.lhs, ctx);
  if (lhsValue === undefined) return false;

  switch (parsed.op) {
    case "==":
      return lhsValue === parsed.rhs || exactDateEq(lhsValue, parsed.rhs);
    case "!=":
      return lhsValue !== parsed.rhs;
    case "<":
      return compare(lhsValue, parsed.rhs) < 0;
    case "<=":
      return compare(lhsValue, parsed.rhs) <= 0;
    case ">":
      return compare(lhsValue, parsed.rhs) > 0;
    case ">=":
      return compare(lhsValue, parsed.rhs) >= 0;
    case "in":
      return Array.isArray(parsed.rhs) && parsed.rhs.includes(String(lhsValue));
    case "not in":
      return Array.isArray(parsed.rhs) && !parsed.rhs.includes(String(lhsValue));
  }
}

function resolveLhs(lhs: string, ctx: AppliesToContext): unknown {
  if (lhs === "shop") return ctx.shop;
  if (lhs === "deal.dealType") return ctx.deal?.dealType;
  if (lhs === "deal.valueCents") return ctx.deal?.valueCents;
  if (lhs === "now") return ctx.now ?? new Date();
  return undefined;
}

function compare(a: unknown, b: unknown): number {
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

function exactDateEq(a: unknown, b: unknown): boolean {
  return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
}
