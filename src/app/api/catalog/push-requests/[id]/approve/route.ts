// src/app/api/catalog/push-requests/[id]/approve/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";
import { executeCatalogPushApproval } from "@/lib/catalog-push-approve";

const ADMIN_ROLES = ["ADMIN", "OWNER", "MANAGER"];

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  if (!ADMIN_ROLES.includes(authResult.role)) {
    return NextResponse.json({ error: "Admin role required" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const result = await executeCatalogPushApproval(id, { source: "approval_retry", userEmail: authResult.email });

    if (result.notFound) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (result.alreadyResolved) {
      return NextResponse.json(
        { error: `Already ${result.alreadyResolved.status.toLowerCase()}` },
        { status: 409 }
      );
    }
    if (result.error) {
      return NextResponse.json(
        {
          error: result.error,
          push: null,
          outcomes: {},
          summary: result.summary,
          retryable: result.retryable,
        },
        { status: 503 }
      );
    }

    return NextResponse.json({
      push: result.push,
      outcomes: result.outcomes,
      summary: result.summary,
      retryable: result.retryable,
    });
  } catch (error) {
    console.error("[catalog] Approval failed:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Approval failed unexpectedly",
        push: null,
        outcomes: {},
        summary: { selected: 0, success: 0, failed: 1, skipped: 0, notImplemented: 0 },
        retryable: true,
      },
      { status: 500 }
    );
  }
}
