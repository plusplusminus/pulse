import { NextResponse } from "next/server";
import { z } from "zod";
import { validateWidgetRequest, isKnownWidgetOrigin } from "@/lib/widget-auth";
import { corsHeaders as originCorsHeaders } from "@/lib/widget-origin";
import { createSlidingWindowLimiter } from "@/lib/widget-rate-limit";
import {
  WIDGET_MEDIA_CONTENT_TYPES,
  WIDGET_MEDIA_KINDS,
  WIDGET_MEDIA_MAX_BYTES,
  signWidgetUpload,
} from "@/lib/widget-upload";

// Widget media upload tickets (PULSE-323). The API only mints signed URLs;
// bytes go browser -> Supabase Storage directly. Budget is separate from the
// feedback route's: one submission may need several tickets (screenshot,
// video, replay) plus retries.
const limiter = createSlidingWindowLimiter({ windowMs: 60_000, max: 30 });

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

    if (limiter.isRateLimited(config.api_key_prefix)) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Try again later." },
        { status: 429, headers }
      );
    }

    const body = await request.json().catch(() => null);
    const parsed = uploadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400, headers }
      );
    }
    const { kind, contentType, sizeBytes } = parsed.data;

    if (!(contentType in WIDGET_MEDIA_CONTENT_TYPES[kind])) {
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
