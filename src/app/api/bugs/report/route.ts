import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserByEmail, logActivity, prisma } from "@/lib/db";
import { sendBugReportEmail } from "@/lib/email";
import { headers } from "next/headers";

/**
 * POST /api/bugs/report
 *
 * Submit a bug report. Stores in database and sends email to techops.
 * Accessible to all authenticated non-VIEWER users.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const user = await getUserByEmail(session.user.email);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 403 });
    }

    if (user.role === "VIEWER") {
      return NextResponse.json({ error: "Not authorized to submit bug reports" }, { status: 403 });
    }

    if (!prisma) {
      return NextResponse.json({ error: "Database not configured" }, { status: 503 });
    }

    const body = await request.json();
    const { title, description, pageUrl } = body;

    if (!title || !description) {
      return NextResponse.json(
        { error: "Title and description are required" },
        { status: 400 }
      );
    }

    if (title.length > 200) {
      return NextResponse.json(
        { error: "Title must be 200 characters or less" },
        { status: 400 }
      );
    }

    if (description.length > 5000) {
      return NextResponse.json(
        { error: "Description must be 5000 characters or less" },
        { status: 400 }
      );
    }

    // Create the bug report
    const report = await prisma.bugReport.create({
      data: {
        title: title.trim(),
        description: description.trim(),
        pageUrl: pageUrl || null,
        reporterEmail: session.user.email,
        reporterName: session.user.name || null,
      },
    });

    // Send email notification (fire and forget)
    let emailSent = false;
    try {
      const emailResult = await sendBugReportEmail({
        reportId: report.id,
        title: report.title,
        description: report.description,
        pageUrl: report.pageUrl || undefined,
        reporterName: report.reporterName || undefined,
        reporterEmail: report.reporterEmail,
      });
      emailSent = emailResult.success;

      // Update email status
      await prisma.bugReport.update({
        where: { id: report.id },
        data: { emailSent },
      });
    } catch (emailErr) {
      console.warn("Failed to send bug report email:", emailErr);
    }

    // Log the activity
    const hdrs = await headers();
    const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const userAgent = hdrs.get("user-agent") || "unknown";

    await logActivity({
      type: "BUG_REPORTED",
      description: `Bug report submitted: ${title}`,
      userEmail: session.user.email,
      userName: session.user.name || undefined,
      entityType: "bug_report",
      entityId: report.id,
      entityName: title,
      metadata: {
        pageUrl,
        emailSent,
      },
      ipAddress: ip,
      userAgent,
    });

    return NextResponse.json({
      success: true,
      reportId: report.id,
      emailSent,
      message: "Bug report submitted successfully. The team has been notified.",
    });
  } catch (error) {
    console.error("Error submitting bug report:", error);
    return NextResponse.json(
      { error: "Failed to submit bug report", details: String(error) },
      { status: 500 }
    );
  }
}
