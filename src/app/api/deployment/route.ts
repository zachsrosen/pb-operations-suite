import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/deployment
 *
 * Webhook endpoint for Vercel deployment events.
 *
 * To set up automatic maintenance mode:
 * 1. Go to Vercel Dashboard > Project > Settings > Git > Deploy Hooks
 * 2. Create a deploy hook (this triggers builds)
 *
 * For deployment status webhooks:
 * 1. Go to Vercel Dashboard > Account Settings > Webhooks
 * 2. Add webhook URL: https://your-domain.com/api/deployment
 * 3. Select events: deployment.created, deployment.succeeded, deployment.failed
 *
 * NOTE: Vercel doesn't support runtime env var changes during deployment.
 * For true automatic maintenance mode, you'd need:
 * - A separate status service (Redis, database, or external API)
 * - Or use Vercel's Edge Config for runtime flags
 *
 * This endpoint logs deployment events for monitoring.
 */

interface VercelWebhookPayload {
  type: string;
  createdAt: number;
  payload: {
    deployment: {
      id: string;
      name: string;
      url: string;
      state: string;
    };
    user: {
      id: string;
      username: string;
    };
  };
}

export async function POST(request: NextRequest) {
  try {
    const body: VercelWebhookPayload = await request.json();

    // Log deployment events
    console.log(`[Deployment] Event: ${body.type}`, {
      deploymentId: body.payload?.deployment?.id,
      state: body.payload?.deployment?.state,
      url: body.payload?.deployment?.url,
      user: body.payload?.user?.username,
      timestamp: new Date(body.createdAt).toISOString(),
    });

    // You could integrate with external services here:
    // - Send Slack notification
    // - Update Redis/database maintenance flag
    // - Trigger Edge Config update

    return NextResponse.json({
      received: true,
      event: body.type,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Deployment] Webhook error:", error);
    return NextResponse.json(
      { error: "Invalid webhook payload" },
      { status: 400 }
    );
  }
}

// Also support GET for health checks
export async function GET() {
  return NextResponse.json({
    status: "ok",
    endpoint: "deployment-webhook",
    timestamp: new Date().toISOString(),
  });
}
