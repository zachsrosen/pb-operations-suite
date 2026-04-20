import { NextResponse } from "next/server";
import { assertOnCallEnabled } from "@/lib/on-call-guard";
import { getCurrentUser } from "@/lib/auth-utils";
import { resolveElectricianByEmail } from "@/lib/on-call-db";

export const dynamic = "force-dynamic";

// V1 STUB — the phone view consumer lands in V1.1.
export async function GET() {
  const gate = assertOnCallEnabled();
  if (gate) return gate;

  const user = await getCurrentUser();
  if (!user?.email) {
    return NextResponse.json({ crewMember: null, shifts: [] });
  }
  const crewMember = await resolveElectricianByEmail(user.email);
  return NextResponse.json({
    crewMember: crewMember
      ? { id: crewMember.id, name: crewMember.name, email: crewMember.email }
      : null,
    shifts: [],
  });
}
