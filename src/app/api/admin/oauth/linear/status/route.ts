import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/admin-auth";
import { getAdminLinearConnectionStatus } from "@/lib/admin-linear-oauth";

export async function GET() {
  try {
    const auth = await withAdminAuth();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { user } = auth;

    const status = await getAdminLinearConnectionStatus(user.id);

    return NextResponse.json({
      connected: status?.connected ?? false,
      linearUserName: status?.linearUserName ?? null,
      linearUserEmail: status?.linearUserEmail ?? null,
      connectedAt: status?.connectedAt?.toISOString() ?? null,
    });
  } catch (error) {
    console.error("GET /api/admin/oauth/linear/status error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
