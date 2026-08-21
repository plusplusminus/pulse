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
const SITE_BUDGET = { limit: 60, windowMs: 60_000 };
const IP_BUDGET = { limit: 10, windowMs: 60_000 };

function tooManyRequests(verdict: RateLimitResult, headers: Record<string, string>) {
  return NextResponse.json(
    { error: "Rate limit exceeded. Try again later." },
    {
      status: 429,
      headers: {
        ...headers,
        "Retry-After": String(Math.max(1, Math.ceil(verdict.retryAfterMs / 1000))),
      },
    }
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
    if (!siteVerdict.allowed) return tooManyRequests(siteVerdict, headers);

    const ipVerdict = await checkRateLimit({
      key: reporterKey(config.api_key_prefix, readClientIp(request)),
      ...IP_BUDGET,
    });
    if (!ipVerdict.allowed) return tooManyRequests(ipVerdict, headers);

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
