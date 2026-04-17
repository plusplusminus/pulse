import { NextRequest, NextResponse } from "next/server";
import { isLinearCdnUrl } from "@/lib/image-proxy";
import { getWorkspaceToken } from "@/lib/workspace";

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");

  if (!url) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  if (!isLinearCdnUrl(url)) {
    return NextResponse.json({ error: "URL is not a recognised Linear CDN domain" }, { status: 400 });
  }

  try {
    const token = await getWorkspaceToken();

    const response = await fetch(url, {
      headers: { Authorization: token.trim() },
    });

    if (!response.ok) {
      console.error(`Linear proxy: returned ${response.status} for ${url}`);
      return NextResponse.json({ error: "Failed to fetch from Linear" }, { status: 502 });
    }

    const contentType = response.headers.get("content-type") ?? "application/octet-stream";
    const contentLength = response.headers.get("content-length");
    const contentDisposition = response.headers.get("content-disposition");
    const body = response.body;

    if (!body) {
      return NextResponse.json({ error: "Empty response from Linear" }, { status: 502 });
    }

    const isImage = contentType.startsWith("image/");

    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": isImage
        ? "default-src 'none'; img-src 'self'"
        : "default-src 'none'",
      "Referrer-Policy": "no-referrer",
    };
    if (contentLength) {
      headers["Content-Length"] = contentLength;
    }
    // For non-image files, pass through Content-Disposition or default to
    // attachment so the browser downloads rather than rendering inline.
    if (!isImage) {
      headers["Content-Disposition"] = contentDisposition ?? "attachment";
    }

    return new NextResponse(body, { status: 200, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("No Linear API token configured")) {
      return NextResponse.json({ error: "Workspace Linear token not configured" }, { status: 503 });
    }
    console.error("Linear proxy error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
