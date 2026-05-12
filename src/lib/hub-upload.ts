/**
 * Shared validation + sanitization for hub file uploads.
 *
 * Used by both the comments upload route and the form submissions upload
 * route so MIME allowlist and size limits stay in sync.
 */

export const ALLOWED_MIME_TYPES = new Set<string>([
  // Images
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  // Documents
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  // Spreadsheets
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  // Archives
  "application/zip",
  // Text
  "text/plain",
]);

/**
 * Mirror of ALLOWED_MIME_TYPES for use in HTML <input accept="..."> attributes.
 * Includes both MIME types and extensions because some browsers (Safari) only
 * apply `accept` reliably with extensions for certain Office formats.
 */
export const ACCEPT_ATTRIBUTE =
  "image/png,image/jpeg,image/gif,image/webp,image/svg+xml,.pdf,.doc,.docx,.xls,.xlsx,.zip,.txt";

export const IMAGE_MAX_SIZE = 10 * 1024 * 1024; // 10MB
export const OTHER_MAX_SIZE = 25 * 1024 * 1024; // 25MB

const ALLOWED_TYPES_MESSAGE =
  'Accepted types: images (PNG, JPEG, GIF, WebP, SVG), documents (PDF, Word, Excel), archives (ZIP), and plain text.';

export function isImageMimeType(contentType: string): boolean {
  return contentType.startsWith("image/");
}

export function maxSizeForMimeType(contentType: string): number {
  return isImageMimeType(contentType) ? IMAGE_MAX_SIZE : OTHER_MAX_SIZE;
}

/**
 * Strip path separators and any non-portable characters out of a filename.
 * Returns "file" if the input collapses to empty.
 */
export function sanitizeFilename(filename: string): string {
  const cleaned = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return cleaned.length > 0 ? cleaned : "file";
}

export type UploadValidationInput = {
  filename?: unknown;
  contentType?: unknown;
  fileSize?: unknown;
};

export type UploadValidationError = {
  status: 400;
  error: string;
};

export type UploadValidationOk = {
  filename: string;
  contentType: string;
  fileSize: number;
  maxSize: number;
};

/**
 * Validate an upload request body. Returns either an error object that the
 * route can return directly, or a normalized payload with the resolved size cap.
 */
export function validateUploadRequest(
  body: UploadValidationInput
): UploadValidationError | UploadValidationOk {
  if (typeof body.filename !== "string" || body.filename.length === 0) {
    return { status: 400, error: "filename is required" };
  }
  if (typeof body.contentType !== "string" || body.contentType.length === 0) {
    return { status: 400, error: "contentType is required" };
  }
  if (typeof body.fileSize !== "number" || !Number.isFinite(body.fileSize) || body.fileSize <= 0) {
    return { status: 400, error: "fileSize must be a positive number" };
  }

  if (!ALLOWED_MIME_TYPES.has(body.contentType)) {
    return {
      status: 400,
      error: `File type "${body.contentType}" is not allowed. ${ALLOWED_TYPES_MESSAGE}`,
    };
  }

  const maxSize = maxSizeForMimeType(body.contentType);
  if (body.fileSize > maxSize) {
    const limitMB = Math.round(maxSize / 1024 / 1024);
    return {
      status: 400,
      error: `File exceeds the ${limitMB}MB size limit`,
    };
  }

  return {
    filename: body.filename,
    contentType: body.contentType,
    fileSize: body.fileSize,
    maxSize,
  };
}

/**
 * Build the public-read URL for an attachment stored in one of the hub upload
 * buckets. Buckets are configured `public: true` in Supabase storage so this
 * URL resolves without auth — that is intentional so non-Linear customers can
 * view attachments from inside the Pulse hub UI.
 */
export function publicAttachmentUrl(
  supabaseUrl: string,
  bucket: string,
  storagePath: string
): string {
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${storagePath}`;
}

const HUB_ATTACHMENT_BUCKET_SEGMENTS = [
  "/comment-attachments/",
  "/form-attachments/",
];

function deriveSupabaseHost(): string | null {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return null;
  try {
    return new URL(raw).hostname;
  } catch {
    return null;
  }
}

const ALLOWED_SUPABASE_HOST = deriveSupabaseHost();

/**
 * True when `url` points at a Pulse hub attachment in our Supabase storage.
 * Used by the markdown renderer to decide whether to swap a plain `<a>` for
 * a styled file chip.
 *
 * Hostname is checked against `NEXT_PUBLIC_SUPABASE_URL` so an attacker can't
 * spoof a Pulse-styled file chip by putting `/comment-attachments/` in their
 * own URL path. `allowedHost` is exposed for tests; production callers omit it.
 */
export function isHubAttachmentUrl(
  url: string,
  allowedHost: string | null = ALLOWED_SUPABASE_HOST
): boolean {
  if (!allowedHost) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  if (parsed.hostname !== allowedHost) return false;
  return HUB_ATTACHMENT_BUCKET_SEGMENTS.some((segment) =>
    parsed.pathname.includes(segment)
  );
}
