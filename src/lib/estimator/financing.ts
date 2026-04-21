export function amortize(principal: number, apr: number, termMonths: number): number {
  if (principal <= 0) return 0;
  if (termMonths <= 0) return 0;
  const r = apr / 12;
  if (r === 0) return principal / termMonths;
  const pow = Math.pow(1 + r, termMonths);
  return (principal * r * pow) / (pow - 1);
}
