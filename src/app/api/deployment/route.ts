import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

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

function signatureMatches(rawHeader: string | null, rawBody: string, secret: string): boolean {
  if (!rawHeader) return false;

  const normalized = rawHeader.trim();
  const headerValue = normalized.includes("=") ? normalized.split("=").pop() || "" : normalized;
  if (!headerValue) return false;

  const expectedSha1 = crypto.createHmac("sha1", secret).update(rawBody).digest("hex");
  const expectedSha256 = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

  const candidates = [expectedSha1, expectedSha256];
  return candidates.some((expected) =>
    headerValue.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(headerValue), Buffer.from(expected))
  );
}

export async function POST(request: NextRequest) {
  try {
    const webhookSecret = process.env.DEPLOYMENT_WEBHOOK_SECRET;
    if (process.env.NODE_ENV === "production" && !webhookSecret) {
      return NextResponse.json(
        { error: "Deployment webhook is not configured" },
        { status: 503 }
      );
    }

    if (webhookSecret) {
      const authHeader = request.headers.get("authorization");
      const sharedSecretHeader = request.headers.get("x-webhook-secret");
      const signatureHeader = request.headers.get("x-vercel-signature");
      const rawBody = await request.text();

      const hasBearerMatch = authHeader === `Bearer ${webhookSecret}`;
      const hasSharedSecretMatch = sharedSecretHeader === webhookSecret;
      const hasSignatureMatch = signatureMatches(signatureHeader, rawBody, webhookSecret);

      if (!hasBearerMatch && !hasSharedSecretMatch && !hasSignatureMatch) {
        return NextResponse.json({ error: "Unauthorized webhook request" }, { status: 401 });
      }

      let body: VercelWebhookPayload;
      try {
        body = JSON.parse(rawBody) as VercelWebhookPayload;
      } catch {
        return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
      }

      // Log deployment events
      console.log(`[Deployment] Event: ${body.type}`, {
        deploymentId: body.payload?.deployment?.id,
        state: body.payload?.deployment?.state,
        url: body.payload?.deployment?.url,
        user: body.payload?.user?.username,
        timestamp: new Date(body.createdAt).toISOString(),
      });

      return NextResponse.json({
        received: true,
        event: body.type,
        timestamp: new Date().toISOString(),
      });
    }

    let body: VercelWebhookPayload;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
    }

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
