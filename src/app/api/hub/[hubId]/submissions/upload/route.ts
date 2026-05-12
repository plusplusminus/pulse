import { NextResponse } from "next/server";
import { withHubAuthWrite, type HubAuthError } from "@/lib/hub-auth";
import { supabaseAdmin } from "@/lib/supabase";
import {
  publicAttachmentUrl,
  sanitizeFilename,
  validateUploadRequest,
} from "@/lib/hub-upload";

const BUCKET = "form-attachments";

/**
 * POST: Get a signed upload URL for form attachments.
 * Allowed types and size limits are defined centrally in `lib/hub-upload.ts`.
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

    const body = (await request.json()) as Record<string, unknown>;
    const validated = validateUploadRequest(body);
    if ("error" in validated) {
      return NextResponse.json(
        { error: validated.error },
        { status: validated.status }
      );
    }

    const sanitized = sanitizeFilename(validated.filename);
    const ext = sanitized.split(".").pop() || "bin";
    const storagePath = `${hubId}/${crypto.randomUUID()}.${ext}`;

    const { data: signedData, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUploadUrl(storagePath);

    if (error || !signedData) {
      throw new Error(
        `Failed to create upload URL: ${error?.message ?? "Unknown error"}`
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) {
      throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured");
    }

    return NextResponse.json({
      signedUrl: signedData.signedUrl,
      storagePath,
      publicUrl: publicAttachmentUrl(supabaseUrl, BUCKET, storagePath),
      token: signedData.token,
      maxSize: validated.maxSize,
    });
  } catch (error) {
    console.error(
      "POST /api/hub/[hubId]/submissions/upload error:",
      error
    );
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
