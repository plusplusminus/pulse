import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { validateWidgetRequest } from "@/lib/widget-auth";
import {
  buildWidgetIssueDescription,
  createWidgetLinearIssue,
} from "@/lib/widget-linear";
import type { WidgetFeedbackResponse } from "@/lib/widget-types";

// In-memory rate limiter: apiKeyPrefix -> timestamps
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW = 60_000;
const RATE_LIMIT_MAX = 10;

function isRateLimited(keyPrefix: string): boolean {
  const now = Date.now();
  const timestamps = rateLimitMap.get(keyPrefix) ?? [];
  const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW);
  if (recent.length >= RATE_LIMIT_MAX) {
    rateLimitMap.set(keyPrefix, recent);
    return true;
  }
  recent.push(now);
  rateLimitMap.set(keyPrefix, recent);
  return false;
}

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Site-Key, X-Widget-Key",
    "Access-Control-Max-Age": "86400",
  };
}

export async function OPTIONS(request: Request) {
  const origin = request.headers.get("origin");
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}

const feedbackSchema = z.object({
  title: z.string().min(1, "Title is required").max(500),
  description: z.string().max(5000).optional(),
  type: z.enum(["bug", "feedback", "idea"]).default("bug"),
  metadata: z.object({
    url: z.string(),
    userAgent: z.string(),
    viewport: z.object({ width: z.number(), height: z.number() }),
    timestamp: z.string(),
    console: z
      .array(
        z.object({
          level: z.string(),
          message: z.string().max(500),
          timestamp: z.string(),
        })
      )
      .max(50)
      .default([]),
    sentry: z
      .object({
        replayId: z.string().nullable(),
        replayUrl: z.string().nullable(),
        sessionId: z.string().nullable(),
        traceId: z.string().nullable(),
      })
      .nullable()
      .default(null),
    custom: z.record(z.string(), z.string()).default({}),
  }),
  reporter: z.object({
    email: z.string().email("Valid email is required"),
    name: z.string().optional(),
  }),
  screenshot: z.string().optional(),
});

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const headers = corsHeaders(origin);

  try {
    // Validate widget key + origin
    const authResult = await validateWidgetRequest(request);
    if ("error" in authResult) {
      return NextResponse.json(
        { error: authResult.error },
        { status: authResult.status, headers }
      );
    }
    const { config } = authResult;

    // Rate limit
    if (isRateLimited(config.api_key_prefix)) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Try again later." },
        { status: 429, headers }
      );
    }

    // Parse + validate body
    const body = await request.json();
    const parsed = feedbackSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400, headers }
      );
    }
    const data = parsed.data;

    // Upload screenshot if provided
    let screenshotUrl: string | undefined;
    if (data.screenshot) {
      try {
        const buffer = Buffer.from(data.screenshot, "base64");
        const filename = `${config.hub_id}/${Date.now()}-${crypto.randomUUID()}.png`;
        const { error: uploadError } = await supabaseAdmin.storage
          .from("widget-screenshots")
          .upload(filename, buffer, { contentType: "image/png" });

        if (!uploadError) {
          const { data: urlData } = supabaseAdmin.storage
            .from("widget-screenshots")
            .getPublicUrl(filename);
          screenshotUrl = urlData.publicUrl;
        }
      } catch {
        // Non-fatal: continue without screenshot
      }
    }

    // Insert submission
    const { data: submission, error: insertError } = await supabaseAdmin
      .from("widget_submissions")
      .insert({
        widget_config_id: config.id,
        hub_id: config.hub_id,
        title: data.title,
        description: data.description ?? null,
        type: data.type,
        screenshot_url: screenshotUrl ?? null,
        metadata: data.metadata,
        reporter_email: data.reporter.email,
        reporter_name: data.reporter.name ?? null,
        page_url: data.metadata.url,
        sync_status: "pending",
      })
      .select("id")
      .single();

    if (insertError || !submission) {
      return NextResponse.json(
        { error: "Failed to save submission" },
        { status: 500, headers }
      );
    }

    // Resolve team from hub_team_mappings
    const { data: mapping } = await supabaseAdmin
      .from("hub_team_mappings")
      .select("linear_team_id")
      .eq("hub_id", config.hub_id)
      .eq("is_active", true)
      .limit(1)
      .single();

    let linearIssueId: string | null = null;
    let linearIssueUrl: string | null = null;
    let syncStatus: "synced" | "failed" = "failed";
    let syncError: string | null = null;

    if (mapping) {
      try {
        const description = buildWidgetIssueDescription({
          description: data.description,
          reporter: data.reporter,
          metadata: data.metadata,
          screenshotUrl,
        });

        const issue = await createWidgetLinearIssue({
          teamId: mapping.linear_team_id,
          title: data.title,
          description,
          screenshotUrl,
        });

        linearIssueId = issue.id;
        linearIssueUrl = issue.url;
        syncStatus = "synced";
      } catch (err) {
        syncError =
          err instanceof Error ? err.message : "Linear sync failed";
      }
    } else {
      syncError = "No active team mapping found for hub";
    }

    // Update submission with sync result
    await supabaseAdmin
      .from("widget_submissions")
      .update({
        linear_issue_id: linearIssueId,
        linear_issue_url: linearIssueUrl,
        sync_status: syncStatus,
        sync_error: syncError,
      })
      .eq("id", submission.id);

    const response: WidgetFeedbackResponse = {
      id: submission.id,
      linearIssueId,
      linearIssueUrl,
      status: syncStatus === "synced" ? "created" : "failed",
    };

    return NextResponse.json(response, { status: 201, headers });
  } catch (error) {
    console.error("POST /api/widget/feedback error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500, headers }
    );
  }
}
