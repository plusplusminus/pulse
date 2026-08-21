import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { withHubAuth, withHubAuthWrite, type HubAuthError } from "@/lib/hub-auth";
import {
  generateWidgetApiKey,
  hashWidgetApiKey,
  widgetApiKeyPrefix,
} from "@/lib/widget-auth";
import type { WidgetConfigCreateResponse } from "@/lib/widget-types";
import { canActivate, invalidOrigins, normaliseOrigins } from "@/lib/widget-origin";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const hubId = searchParams.get("hubId");

    if (!hubId) {
      return NextResponse.json(
        { error: "hubId query parameter is required" },
        { status: 400 }
      );
    }

    const auth = await withHubAuth(hubId);
    if ("error" in auth) {
      return NextResponse.json(
        { error: (auth as HubAuthError).error },
        { status: (auth as HubAuthError).status }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("widget_configs")
      .select(
        "id, hub_id, api_key_prefix, name, is_active, config, allowed_origins, output_detail_level, created_at, updated_at"
      )
      .eq("hub_id", hubId)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        { error: "Failed to fetch widget configs" },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("GET /api/widget/config error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { hubId, name, allowed_origins, config } = body as {
      hubId?: string;
      name?: string;
      allowed_origins?: string[];
      config?: Record<string, unknown>;
    };

    if (!hubId) {
      return NextResponse.json(
        { error: "hubId is required" },
        { status: 400 }
      );
    }

    const auth = await withHubAuthWrite(hubId);
    if ("error" in auth) {
      return NextResponse.json(
        { error: (auth as HubAuthError).error },
        { status: (auth as HubAuthError).status }
      );
    }

    const bad = invalidOrigins(allowed_origins ?? []);
    if (bad.length > 0) {
      return NextResponse.json(
        { error: "invalid_origin", message: `Not a valid origin: ${bad.join(", ")}` },
        { status: 400 }
      );
    }
    const origins = normaliseOrigins(allowed_origins);

    const apiKey = generateWidgetApiKey();
    const apiKeyHash = await hashWidgetApiKey(apiKey);
    const apiKeyPrefix = widgetApiKeyPrefix(apiKey);

    const { data, error } = await supabaseAdmin
      .from("widget_configs")
      .insert({
        hub_id: hubId,
        api_key_hash: apiKeyHash,
        api_key_prefix: apiKeyPrefix,
        name: name || "Default Widget",
        allowed_origins: origins,
        // A site cannot be active without an allowlist; created inactive until origins are added.
        is_active: canActivate(origins),
        config: config ?? {},
      })
      .select("id")
      .single();

    if (error || !data) {
      console.error("POST /api/widget/config insert error:", error);
      return NextResponse.json(
        { error: "Failed to create widget config" },
        { status: 500 }
      );
    }

    const response: WidgetConfigCreateResponse = {
      id: data.id,
      apiKey,
      apiKeyPrefix,
      name: name || "Default Widget",
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error("POST /api/widget/config error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
