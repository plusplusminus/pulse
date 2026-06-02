import { NextResponse } from "next/server";
import { withHubAuth, type HubAuthError } from "@/lib/hub-auth";
import {
  getPreferencesForUser,
  upsertPreferences,
  EVENT_TYPES,
  type NotificationEventType,
} from "@/lib/notification-preferences";
import {
  getCommentScope,
  upsertCommentScope,
  COMMENT_SCOPES,
  type CommentScope,
} from "@/lib/notification-settings";

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

    const [preferences, commentScope] = await Promise.all([
      getPreferencesForUser(hubId, auth.user.id),
      getCommentScope(hubId, auth.user.id),
    ]);
    return NextResponse.json({
      preferences,
      settings: { comment_scope: commentScope },
    });
  } catch (error) {
    console.error("GET /api/hub/[hubId]/notifications/preferences error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: Request,
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

    const body = (await request.json()) as {
      preferences?: Array<{
        event_type: string;
        in_app_enabled?: boolean;
        email_mode?: string;
        digest_time?: string;
        timezone?: string;
      }>;
      settings?: { comment_scope?: string };
    };

    if (!Array.isArray(body.preferences) || body.preferences.length === 0) {
      return NextResponse.json(
        { error: "preferences array is required" },
        { status: 400 }
      );
    }

    const validEventTypes = new Set<string>(EVENT_TYPES);
    const validEmailModes = new Set(["off", "immediate", "daily", "weekly"]);

    for (const pref of body.preferences) {
      if (!validEventTypes.has(pref.event_type)) {
        return NextResponse.json(
          { error: `Invalid event_type: ${pref.event_type}` },
          { status: 400 }
        );
      }
      if (pref.email_mode && !validEmailModes.has(pref.email_mode)) {
        return NextResponse.json(
          { error: `Invalid email_mode: ${pref.email_mode}` },
          { status: 400 }
        );
      }
    }

    const commentScopeInput = body.settings?.comment_scope;
    if (
      commentScopeInput !== undefined &&
      !COMMENT_SCOPES.includes(commentScopeInput as CommentScope)
    ) {
      return NextResponse.json(
        { error: `Invalid comment_scope: ${commentScopeInput}` },
        { status: 400 }
      );
    }

    const preferences = await upsertPreferences(
      hubId,
      auth.user.id,
      body.preferences as Array<{
        event_type: NotificationEventType;
        in_app_enabled?: boolean;
        email_mode?: "off" | "immediate" | "daily" | "weekly";
        digest_time?: string;
        timezone?: string;
      }>
    );

    const commentScope =
      commentScopeInput !== undefined
        ? await upsertCommentScope(
            hubId,
            auth.user.id,
            commentScopeInput as CommentScope
          )
        : await getCommentScope(hubId, auth.user.id);

    return NextResponse.json({
      preferences,
      settings: { comment_scope: commentScope },
    });
  } catch (error) {
    console.error("PUT /api/hub/[hubId]/notifications/preferences error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
