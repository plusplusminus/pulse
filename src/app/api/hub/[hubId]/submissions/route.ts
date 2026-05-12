import { NextResponse } from "next/server";
import {
  withHubAuth,
  withHubAuthWrite,
  type HubAuthError,
} from "@/lib/hub-auth";
import { supabaseAdmin, type AttachmentMetadata } from "@/lib/supabase";
import { processFormSubmission } from "@/lib/form-submit";
import { ALLOWED_MIME_TYPES } from "@/lib/hub-upload";
import { captureServerEvent } from "@/lib/posthog-server";
import { POSTHOG_EVENTS } from "@/lib/posthog-events";

function normalizeAttachments(
  raw: unknown,
  legacyPaths: unknown
): AttachmentMetadata[] {
  if (Array.isArray(raw)) {
    const result: AttachmentMetadata[] = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      if (typeof e.path !== "string" || e.path.length === 0) continue;
      if (typeof e.fileName !== "string" || e.fileName.length === 0) continue;
      if (typeof e.contentType !== "string" || !ALLOWED_MIME_TYPES.has(e.contentType)) continue;
      result.push({ path: e.path, fileName: e.fileName, contentType: e.contentType });
    }
    return result;
  }
  // Backward compat: older clients still send `attachmentPaths: string[]`.
  // Treat each as an image (the only previously supported type).
  if (Array.isArray(legacyPaths)) {
    return legacyPaths
      .filter((p): p is string => typeof p === "string" && p.length > 0)
      .map((path) => ({
        path,
        fileName: path.split("/").pop() ?? path,
        contentType: "image/*",
      }));
  }
  return [];
}

/**
 * POST: Submit a form.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ hubId: string }> }
) {
  try {
    const { hubId } = await params;

    const auth = await withHubAuthWrite(hubId);
    if ("error" in auth) {
      return NextResponse.json(
        { error: (auth as HubAuthError).error },
        { status: (auth as HubAuthError).status }
      );
    }

    const { user } = auth;

    const body = (await request.json()) as {
      formId?: string;
      fieldValues?: Record<string, unknown>;
      attachmentPaths?: string[];
      attachments?: unknown;
      teamId?: string;
      projectId?: string;
    };

    if (!body.formId) {
      return NextResponse.json(
        { error: "formId is required" },
        { status: 400 }
      );
    }

    if (!body.fieldValues || typeof body.fieldValues !== "object") {
      return NextResponse.json(
        { error: "fieldValues is required" },
        { status: 400 }
      );
    }

    const attachments = normalizeAttachments(body.attachments, body.attachmentPaths);

    const result = await processFormSubmission(
      body.formId,
      hubId,
      body.fieldValues,
      attachments,
      {
        id: user.id,
        email: user.email,
        name:
          [user.firstName, user.lastName].filter(Boolean).join(" ") || undefined,
      },
      body.teamId,
      body.projectId,
    );

    captureServerEvent(user.id || "anonymous", POSTHOG_EVENTS.form_submission_created, { hubId });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error("POST /api/hub/[hubId]/submissions error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * GET: My submission history.
 * Joins against synced_issues on linear_issue_id to get current state/status.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ hubId: string }> }
) {
  try {
    const { hubId } = await params;

    const auth = await withHubAuth(hubId);
    if ("error" in auth) {
      return NextResponse.json(
        { error: (auth as HubAuthError).error },
        { status: (auth as HubAuthError).status }
      );
    }

    const { user } = auth;

    // Fetch submissions for this user
    const { data: submissions, error } = await supabaseAdmin
      .from("form_submissions")
      .select("id, form_id, derived_title, sync_status, linear_issue_id, linear_issue_identifier, sync_error, created_at")
      .eq("hub_id", hubId)
      .eq("submitter_user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      throw new Error(`Failed to fetch submissions: ${error.message}`);
    }

    // Fetch form names for display
    const formIds = [...new Set((submissions ?? []).map((s) => s.form_id))];
    const formNameMap = new Map<string, { name: string; type: string }>();

    if (formIds.length > 0) {
      const { data: forms } = await supabaseAdmin
        .from("form_templates")
        .select("id, name, type")
        .in("id", formIds);

      for (const f of forms ?? []) {
        formNameMap.set(f.id, { name: f.name, type: f.type });
      }
    }

    // Fetch current Linear issue state for synced submissions
    const linearIds = (submissions ?? [])
      .filter((s) => s.linear_issue_id)
      .map((s) => s.linear_issue_id!);

    const issueStateMap = new Map<
      string,
      { state_name: string | null }
    >();

    if (linearIds.length > 0) {
      const { data: issues } = await supabaseAdmin
        .from("synced_issues")
        .select("linear_id, state_name")
        .in("linear_id", linearIds);

      for (const issue of issues ?? []) {
        issueStateMap.set(issue.linear_id, {
          state_name: issue.state_name,
        });
      }
    }

    const result = (submissions ?? []).map((s) => {
      const form = formNameMap.get(s.form_id);
      const issueState = s.linear_issue_id
        ? issueStateMap.get(s.linear_issue_id)
        : null;

      return {
        id: s.id,
        form_name: form?.name ?? "Unknown",
        form_type: form?.type ?? "custom",
        derived_title: s.derived_title,
        sync_status: s.sync_status,
        linear_issue_identifier: s.linear_issue_identifier,
        linear_issue_state: issueState?.state_name ?? null,
        sync_error: s.sync_error,
        created_at: s.created_at,
      };
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("GET /api/hub/[hubId]/submissions error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
