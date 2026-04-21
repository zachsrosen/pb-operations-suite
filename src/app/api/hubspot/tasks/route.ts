/**
 * POST /api/hubspot/tasks
 *
 * Creates a new HubSpot task owned by the current user. Supports optional
 * associations to a deal / contact / ticket.
 */

import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { appCache } from "@/lib/cache";
import {
  createTask,
  resolveOwnerIdByEmail,
  type CreateTaskInput,
} from "@/lib/hubspot-tasks";

const ALLOWED_PRIORITY = new Set(["HIGH", "MEDIUM", "LOW"]);
const ALLOWED_TYPE = new Set(["CALL", "EMAIL", "TODO"]);

export async function POST(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let linkedOwnerId: string | null = null;
  try {
    const user = await prisma?.user.findUnique({
      where: { email },
      select: { hubspotOwnerId: true },
    });
    linkedOwnerId = user?.hubspotOwnerId ?? null;
  } catch {
    // ignore
  }

  const ownerId = await resolveOwnerIdByEmail(email, session.user?.name, linkedOwnerId);
  if (!ownerId) {
    return NextResponse.json(
      { error: "Your account is not linked to a HubSpot owner. Ask an admin to link it in /admin/users." },
      { status: 400 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body.subject !== "string" || body.subject.trim().length === 0) {
    return NextResponse.json({ error: "subject is required" }, { status: 400 });
  }

  const input: CreateTaskInput = {
    subject: body.subject.trim().slice(0, 500),
    ownerId,
  };

  if (typeof body.body === "string") input.body = body.body.slice(0, 10_000);
  if (typeof body.dueAt === "string" && !isNaN(new Date(body.dueAt).getTime())) {
    input.dueAt = new Date(body.dueAt).toISOString();
  }
  if (typeof body.priority === "string" && ALLOWED_PRIORITY.has(body.priority)) {
    input.priority = body.priority as CreateTaskInput["priority"];
  }
  if (typeof body.type === "string" && ALLOWED_TYPE.has(body.type)) {
    input.type = body.type as CreateTaskInput["type"];
  }

  const associate: NonNullable<CreateTaskInput["associate"]> = {};
  if (typeof body.dealId === "string" && /^\d{1,20}$/.test(body.dealId)) associate.dealId = body.dealId;
  if (typeof body.ticketId === "string" && /^\d{1,20}$/.test(body.ticketId)) associate.ticketId = body.ticketId;
  if (typeof body.contactId === "string" && /^\d{1,20}$/.test(body.contactId)) associate.contactId = body.contactId;
  if (Object.keys(associate).length > 0) input.associate = associate;

  try {
    const result = await createTask(input);
    appCache.invalidateByPrefix("hubspot:tasks:owner:");
    return NextResponse.json({ id: result.id });
  } catch (err) {
    Sentry.captureException(err, { tags: { module: "api.hubspot.tasks.create", email } });
    return NextResponse.json({ error: "Failed to create task" }, { status: 502 });
  }
}
