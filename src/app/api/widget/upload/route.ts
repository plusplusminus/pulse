import { NextResponse } from "next/server";
import { z } from "zod";
import { validateWidgetRequest } from "@/lib/widget-auth";
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

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Widget-Key",
    "Access-Control-Max-Age": "86400",
  };
}

export async function OPTIONS(request: Request) {
  const origin = request.headers.get("origin");
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}

const uploadSchema = z.object({
  kind: z.enum(WIDGET_MEDIA_KINDS),
  contentType: z.string().min(1).max(100),
  sizeBytes: z.number().int().positive(),
});

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const headers = corsHeaders(origin);

  try {
    const authResult = await validateWidgetRequest(request);
    if ("error" in authResult) {
      return NextResponse.json(
        { error: authResult.error },
        { status: authResult.status, headers }
      );
    }
    const { config } = authResult;

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
