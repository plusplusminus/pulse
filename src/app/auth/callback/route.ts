import { handleAuth } from "@workos-inc/authkit-nextjs";
import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";

export const GET = handleAuth({
  returnPathname: "/",
  onError: async ({ error, request }) => {
    const url = new URL("/auth/error", request.url);

    Sentry.captureException(error ?? new Error("Auth callback failed"), {
      tags: { area: "auth" },
      extra: {
        callbackUrl: request.url,
        hasCode: request.nextUrl.searchParams.has("code"),
        hasState: request.nextUrl.searchParams.has("state"),
      },
    });

    return NextResponse.redirect(url);
  },
});
