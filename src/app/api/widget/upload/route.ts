import { NextResponse } from "next/server";
import { z } from "zod";
import { validateWidgetRequest, isKnownWidgetOrigin } from "@/lib/widget-auth";
import { corsHeaders as originCorsHeaders, readClientIp } from "@/lib/widget-origin";
import {
  checkRateLimit,
  reporterKey,
  siteKey,
  type RateLimitResult,
} from "@/lib/widget-rate-limit";
import {
  WIDGET_MEDIA_CONTENT_TYPES,
  baseContentType,
  WIDGET_MEDIA_KINDS,
  WIDGET_MEDIA_MAX_BYTES,
  signWidgetUpload,
} from "@/lib/widget-upload";

// Widget media upload tickets (PULSE-323). The API only mints signed URLs;
// bytes go browser -> Supabase Storage directly. Budgets are distributed
// (PULSE-313): per site, then per IP (the ticket body carries no reporter).
//
// Unlike /feedback, this route fails CLOSED when the limiter backend is down
// (`onError: "deny"`). A ticketed object is only ever discovered through a
// non-null path column on a widget_submissions row, so bytes uploaded against
// a ticket that is never attached are referenced by nothing and the retention
// cron never sees them. With the limiter open, one site key sustains ~60 x
// 100 MB per minute of storage nothing can purge — and the limiter opens
// precisely when Upstash is under the flood it exists to stop.
const SITE_BUDGET = { limit: 60, windowMs: 60_000, onError: "deny" } as const;
const IP_BUDGET = { limit: 10, windowMs: 60_000, onError: "deny" } as const;

function rateLimited(verdict: RateLimitResult, headers: Record<string, string>) {
  const retryAfter = {
    "Retry-After": String(Math.max(1, Math.ceil(verdict.retryAfterMs / 1000))),
  };
  // "We cannot check your budget right now" is an outage on our side, not a
  // budget the caller blew: 503, and a distinct error code, so a client (and
  // anything reading these logs) can tell an Upstash outage from a flood.
  return verdict.unverified
    ? NextResponse.json(
        {
          error: "rate_limit_unavailable",
          message:
            "Upload tickets are unavailable right now. Please try again shortly.",
        },
        { status: 503, headers: { ...headers, ...retryAfter } }
      )
    : NextResponse.json(
        { error: "Rate limit exceeded. Try again later." },
        { status: 429, headers: { ...headers, ...retryAfter } }
      );
}

// CORS follows the PULSE-392 origin policy (src/lib/widget-origin.ts): headers
// only for an allowlisted origin, never "*".
function corsHeaders(origin: string | null, allowed: boolean): Record<string, string> {
  return originCorsHeaders(origin, { allowed, methods: "POST, OPTIONS" });
}

export async function OPTIONS(request: Request) {
  const origin = request.headers.get("origin");
  // Preflight carries no site key: allow when any active site lists this origin.
  const allowed = await isKnownWidgetOrigin(origin);
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(origin, allowed),
  });
}

const uploadSchema = z.object({
  kind: z.enum(WIDGET_MEDIA_KINDS),
  contentType: z.string().min(1).max(100),
  sizeBytes: z.number().int().positive(),
});

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  let headers = corsHeaders(origin, false);

  try {
    const authResult = await validateWidgetRequest(request);
    if ("error" in authResult) {
      // 401 (bad key) on a known origin stays readable by the page; 403 never gets CORS.
      const readable =
        authResult.status !== 403 && (await isKnownWidgetOrigin(origin));
      return NextResponse.json(
        { error: authResult.error },
        { status: authResult.status, headers: corsHeaders(origin, readable) }
      );
    }
    const { config } = authResult;
    headers = corsHeaders(origin, true);

    const siteVerdict = await checkRateLimit({
      key: siteKey(config.api_key_prefix),
      ...SITE_BUDGET,
    });
    if (!siteVerdict.allowed) return rateLimited(siteVerdict, headers);

    const ipVerdict = await checkRateLimit({
      key: reporterKey(config.api_key_prefix, readClientIp(request)),
      ...IP_BUDGET,
    });
    if (!ipVerdict.allowed) return rateLimited(ipVerdict, headers);

    const body = await request.json().catch(() => null);
    const parsed = uploadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400, headers }
      );
    }
    const { kind, contentType, sizeBytes } = parsed.data;

    // Object.hasOwn, not `in`: `in` walks the prototype chain, so "__proto__"
    // and "constructor" would pass the allowlist and mint a real ticket.
    if (
      !Object.hasOwn(WIDGET_MEDIA_CONTENT_TYPES[kind], baseContentType(contentType))
    ) {
      return NextResponse.json(
        {
          error: `Content type "${contentType}" is not allowed for ${kind}. Accepted: ${Object.keys(WIDGET_MEDIA_CONTENT_TYPES[kind]).join(", ")}`,
        },
        { status: 400, headers }
      );
    }

    const maxBytes = WIDGET_MEDIA_MAX_BYTES[kind];
    if (sizeBytes > maxBytes) {
      return NextResponse.json(
        {
          error: `${kind} exceeds the ${Math.round(maxBytes / 1024 / 1024)}MB size limit`,
        },
        { status: 413, headers }
      );
    }

    const ticket = await signWidgetUpload({
      hubId: config.hub_id,
      kind,
      contentType,
    });

    return NextResponse.json({ ...ticket, maxBytes }, { status: 200, headers });
  } catch (error) {
    console.error("POST /api/widget/upload error:", error);
    return NextResponse.json(
      { error: "Failed to create upload URL" },
      { status: 500, headers }
    );
  }
}
