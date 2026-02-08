import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/impersonate
 * Start impersonating another user (admin only)
 * DISABLED: Requires database migration - run `npx prisma db push` first
 */
export async function POST(request: NextRequest) {
  return NextResponse.json({
    error: "Impersonation disabled - database migration required. Run: npx prisma db push"
  }, { status: 503 });
}

/**
 * DELETE /api/admin/impersonate
 * Stop impersonating (return to admin view)
 * DISABLED: Requires database migration - run `npx prisma db push` first
 */
export async function DELETE() {
  return NextResponse.json({ success: true, message: "Impersonation disabled" });
}

/**
 * GET /api/admin/impersonate
 * Get current impersonation status
 * DISABLED: Requires database migration - run `npx prisma db push` first
 */
export async function GET() {
  return NextResponse.json({ isImpersonating: false });
}
