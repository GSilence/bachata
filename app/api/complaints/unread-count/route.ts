import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { isAdmin } from "@/lib/roles";
import { prisma } from "@/lib/prisma";

// GET — count of "new" complaints the user hasn't dealt with
// Admin: complaints with status="sent" (new, not yet reviewed)
// Regular user: their complaints where status != "sent" (admin has responded)
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const admin = isAdmin(user.role);

    let count: number;
    if (admin) {
      count = await prisma!.complaint.count({
        where: { status: "sent" },
      });
    } else {
      count = await prisma!.complaint.count({
        where: {
          userId: user.userId,
          status: { not: "sent" },
        },
      });
    }

    return NextResponse.json({ count });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Server error";
    if (msg === "Unauthorized" || msg === "Invalid token") {
      return NextResponse.json({ error: msg }, { status: 401 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
