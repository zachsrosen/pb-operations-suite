/**
 * Shared revenue period generation and formatting utilities.
 * Used by PE Dashboard and Executive Suite (Command Center) revenue views.
 */

export interface RevenuePeriod {
  label: string;
  start: Date;
  end: Date;
  isCurrent: boolean;
  isPast: boolean;
}

export interface MilestoneConfig {
  title: string;
  dateField: string;
  forecastField: string;
  borderColor: string;
  barColor: string;
  headerBg: string;
}

/**
 * Generate monthly periods: 2 months back + current + 5 months forward
 */
export function generateMonthlyPeriods(): RevenuePeriod[] {
  const today = new Date();
  const currentMonth = today.getMonth();
  const currentYear = today.getFullYear();
  const months: RevenuePeriod[] = [];
  for (let i = -2; i <= 5; i++) {
    const d = new Date(currentYear, currentMonth + i, 1);
    const endOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
    months.push({
      label: d.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
      start: d,
      end: endOfMonth,
      isCurrent: i === 0,
      isPast: i < 0,
    });
  }
  return months;
}

/**
 * Generate weekly periods: 4 weeks back + current + 7 weeks forward
 */
export function generateWeeklyPeriods(): RevenuePeriod[] {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const weeks: RevenuePeriod[] = [];
  for (let i = -4; i <= 7; i++) {
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() + mondayOffset + i * 7);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 4);
    weekEnd.setHours(23, 59, 59, 999);
    weeks.push({
      label: weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      start: weekStart,
      end: weekEnd,
      isCurrent: i === 0,
      isPast: i < 0,
    });
  }
  return weeks;
}

/**
 * Format revenue as short string: $1.2M, $450K, $25K
 */
export function formatRevenueShort(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1000) return `$${(amount / 1000).toFixed(0)}K`;
  return `$${amount.toFixed(0)}`;
}
