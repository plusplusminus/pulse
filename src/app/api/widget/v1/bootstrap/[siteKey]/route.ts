import { NextResponse } from "next/server";
import { validateWidgetKey } from "@/lib/widget-auth";
import { buildBootstrapPayload } from "@/lib/widget-bootstrap";
import { corsHeaders, isOriginAllowed, readClientIp } from "@/lib/widget-origin";
import { bootstrapKey, checkRateLimit } from "@/lib/widget-rate-limit";

/**
 * Public per-site runtime config for the embed. The site key is an identifier,
 * not a secret; the response carries no hashes, prefixes or tenant ids.
 * Cached 60 s at the edge, varied by Origin.
 */
const CACHE_CONTROL = "public, max-age=60, s-maxage=60";

// Per-IP budget (PULSE-313), checked before the site lookup so a flood never
// reaches the database. The origin is unknown at that point, so a 429 carries
// no CORS headers.
const IP_BUDGET = { limit: 60, windowMs: 60_000 };

function apiBase(request: Request): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
}

export async function OPTIONS(
  request: Request,
  { params }: { params: Promise<{ siteKey: string }> }
) {
  const origin = request.headers.get("origin");
  const { siteKey } = await params;
  const config = await validateWidgetKey(siteKey);
  const allowed = !!config && isOriginAllowed(config, origin);
  return new NextResponse(null, {
    status: allowed ? 204 : 403,
    headers: corsHeaders(origin, { allowed }),
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ siteKey: string }> }
) {
  const origin = request.headers.get("origin");
  try {
    const verdict = await checkRateLimit({
      key: bootstrapKey(readClientIp(request)),
      ...IP_BUDGET,
    });
    if (!verdict.allowed) {
      return NextResponse.json(
        { error: "rate_limited" },
        {
          status: 429,
          headers: {
            Vary: "Origin",
            "Retry-After": String(Math.max(1, Math.ceil(verdict.retryAfterMs / 1000))),
          },
        }
      );
    }

    const { siteKey } = await params;
    const config = await validateWidgetKey(siteKey);
    if (!config) {
      return NextResponse.json(
        { error: "site_not_found" },
        { status: 404, headers: { Vary: "Origin" } }
      );
    }

    if (!isOriginAllowed(config, origin)) {
      return NextResponse.json(
        { error: "origin_not_allowed" },
        { status: 403, headers: corsHeaders(origin, { allowed: false }) }
      );
    }

    const payload = buildBootstrapPayload(config, { apiBase: apiBase(request) });
    return NextResponse.json(payload, {
      status: 200,
      headers: {
        ...corsHeaders(origin, { allowed: true }),
        "Cache-Control": CACHE_CONTROL,
      },
    });
  } catch (error) {
    console.error("GET /api/widget/v1/bootstrap/[siteKey] error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: { Vary: "Origin" } }
    );
  }
}
