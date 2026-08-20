import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { withHubAuthWrite, type HubAuthError } from "@/lib/hub-auth";
import {
  generateWidgetApiKey,
  hashWidgetApiKey,
  widgetApiKeyPrefix,
} from "@/lib/widget-auth";
import type { WidgetConfigRotateResponse } from "@/lib/widget-types";

/**
 * Issue a new site key for a widget config. The old key stops validating the
 * moment the hash is replaced; the full new key is returned exactly once.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ configId: string }> }
) {
  try {
    const { configId } = await params;

    const { data: existing } = await supabaseAdmin
      .from("widget_configs")
      .select("hub_id")
      .eq("id", configId)
      .single();

    if (!existing) {
      return NextResponse.json(
        { error: "Widget config not found" },
        { status: 404 }
      );
    }

    const auth = await withHubAuthWrite(existing.hub_id);
    if ("error" in auth) {
      return NextResponse.json(
        { error: (auth as HubAuthError).error },
        { status: (auth as HubAuthError).status }
      );
    }

    const apiKey = generateWidgetApiKey();
    const apiKeyPrefix = widgetApiKeyPrefix(apiKey);

    const { error } = await supabaseAdmin
      .from("widget_configs")
      .update({
        api_key_hash: await hashWidgetApiKey(apiKey),
        api_key_prefix: apiKeyPrefix,
        updated_at: new Date().toISOString(),
      })
      .eq("id", configId);

    if (error) {
      console.error("widget_configs rotate error:", error);
      return NextResponse.json(
        { error: "Failed to rotate site key" },
        { status: 500 }
      );
    }

    const response: WidgetConfigRotateResponse = {
      id: configId,
      apiKey,
      apiKeyPrefix,
    };
    return NextResponse.json(response);
  } catch (error) {
    console.error("POST /api/widget/config/[configId]/rotate error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
