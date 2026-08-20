import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/admin-auth";
import { revokeAdminLinearToken } from "@/lib/admin-linear-oauth";

export async function DELETE() {
  try {
    const auth = await withAdminAuth();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const { user } = auth;

    await revokeAdminLinearToken(user.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/admin/oauth/linear/disconnect error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
