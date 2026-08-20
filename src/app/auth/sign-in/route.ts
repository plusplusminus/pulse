import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const organizationId = searchParams.get("organizationId") ?? undefined;
  const state = searchParams.get("state") ?? undefined;

  const signInUrl = await getSignInUrl({ organizationId, state });

  return NextResponse.redirect(signInUrl);
}
