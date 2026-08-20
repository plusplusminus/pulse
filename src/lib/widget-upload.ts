/**
 * Signed upload / read / delete for widget media in the private Supabase
 * Storage bucket `widget-media` (PULSE-322).
 *
 * Object layout: {hubId}/{screenshots|videos|replays}/{uuid}.{ext}
 * The per-hub prefix is enforced by STORAGE_PATH_PATTERN so a path can never
 * address another hub's objects. All calls go through the service-role client;
 * nothing here is reachable with the anon key. The storage client is injected
 * so the module is unit-testable without a live Supabase.
 */
import { supabaseAdmin } from "@/lib/supabase";

export const WIDGET_MEDIA_BUCKET = "widget-media";

export type WidgetMediaKind = "screenshot" | "video" | "replay";

export const WIDGET_MEDIA_KINDS: readonly WidgetMediaKind[] = [
  "screenshot",
  "video",
  "replay",
];

/** Per-kind size caps checked before a URL is minted (bytes). */
export const WIDGET_MEDIA_MAX_BYTES: Record<WidgetMediaKind, number> = {
  screenshot: 10 * 1024 * 1024,
  video: 100 * 1024 * 1024,
  replay: 20 * 1024 * 1024,
};

/** MIME allowlist per kind; the value is the file extension used in the key. */
export const WIDGET_MEDIA_CONTENT_TYPES: Record<
  WidgetMediaKind,
  Record<string, string>
> = {
  screenshot: { "image/png": "png", "image/jpeg": "jpg" },
  video: { "video/webm": "webm", "video/mp4": "mp4" },
  replay: { "application/json": "json" },
};

const KIND_FOLDERS: Record<WidgetMediaKind, string> = {
  screenshot: "screenshots",
  video: "videos",
  replay: "replays",
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// {hubId}/{folder}/{filename} — anchored, filename has no slashes, so a path
// cannot traverse out of its per-hub prefix.
export const STORAGE_PATH_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(screenshots|videos|replays)\/[A-Za-z0-9._-]+$/i;

const UPLOAD_EXPIRY_SECONDS = 300; // 5 min — our contract; Supabase's token lasts 2 h
const READ_EXPIRY_SECONDS = 600; // 10 min — the proxy mints a fresh one per request

type StorageResult<T> = Promise<{
  data: T | null;
  error: { message: string } | null;
}>;

/** Structural subset of `supabaseAdmin.storage` so tests can inject a fake. */
export type WidgetStorageClient = {
  from(bucket: string): {
    createSignedUploadUrl(
      path: string
    ): StorageResult<{ signedUrl: string; token: string; path: string }>;
    createSignedUrl(
      path: string,
      expiresIn: number
    ): StorageResult<{ signedUrl: string }>;
    remove(paths: string[]): StorageResult<unknown>;
  };
};

export type SignWidgetUploadInput = {
  hubId: string;
  kind: WidgetMediaKind;
  contentType: string;
  generateId?: () => string;
  now?: Date;
  storage?: WidgetStorageClient;
};

export type SignWidgetUploadResult = {
  uploadUrl: string;
  token: string;
  storagePath: string;
  expiresAt: string;
  /** Absolute TUS endpoint for resumable uploads (> 6 MB); same token via `x-signature`. */
  resumableEndpoint: string;
  bucket: string;
};

export type SignWidgetReadInput = {
  storagePath: string;
  expiresInSeconds?: number;
  now?: Date;
  storage?: WidgetStorageClient;
};

export type SignWidgetReadResult = {
  url: string;
  expiresAt: string;
};

function storageClient(injected?: WidgetStorageClient): WidgetStorageClient {
  return injected ?? (supabaseAdmin.storage as unknown as WidgetStorageClient);
}

// Signed upload URLs look like {storageUrl}/object/upload/sign/{bucket}/{path}?token=…;
// the TUS endpoint is a sibling of /object on the same storage base.
function resumableEndpointFor(uploadUrl: string): string {
  const url = new URL(uploadUrl);
  const idx = url.pathname.indexOf("/object/upload/sign/");
  if (idx === -1) {
    throw new Error(`Unexpected signed upload URL shape: ${url.pathname}`);
  }
  return `${url.origin}${url.pathname.slice(0, idx)}/upload/resumable`;
}

export async function signWidgetUpload(
  input: SignWidgetUploadInput
): Promise<SignWidgetUploadResult> {
  if (!UUID_PATTERN.test(input.hubId)) {
    throw new Error(`Invalid hub id: ${input.hubId}`);
  }

  const folder = KIND_FOLDERS[input.kind];
  if (!folder) {
    throw new Error(`Invalid media kind: ${String(input.kind)}`);
  }

  const ext = WIDGET_MEDIA_CONTENT_TYPES[input.kind][input.contentType];
  if (!ext) {
    throw new Error(
      `Unsupported content type for ${input.kind}: ${input.contentType}`
    );
  }

  const id = input.generateId ? input.generateId() : crypto.randomUUID();
  const storagePath = `${input.hubId}/${folder}/${id}.${ext}`;

  const { data, error } = await storageClient(input.storage)
    .from(WIDGET_MEDIA_BUCKET)
    .createSignedUploadUrl(storagePath);

  if (error || !data) {
    throw new Error(
      `Failed to create upload URL: ${error?.message ?? "Unknown error"}`
    );
  }

  const now = input.now ?? new Date();
  const expiresAt = new Date(
    now.getTime() + UPLOAD_EXPIRY_SECONDS * 1000
  ).toISOString();

  return {
    uploadUrl: data.signedUrl,
    token: data.token,
    storagePath,
    expiresAt,
    resumableEndpoint: resumableEndpointFor(data.signedUrl),
    bucket: WIDGET_MEDIA_BUCKET,
  };
}

export async function signWidgetRead(
  input: SignWidgetReadInput
): Promise<SignWidgetReadResult> {
  if (!STORAGE_PATH_PATTERN.test(input.storagePath)) {
    throw new Error(`Invalid storage path: ${input.storagePath}`);
  }

  const expiresInSeconds = input.expiresInSeconds ?? READ_EXPIRY_SECONDS;

  const { data, error } = await storageClient(input.storage)
    .from(WIDGET_MEDIA_BUCKET)
    .createSignedUrl(input.storagePath, expiresInSeconds);

  if (error || !data) {
    throw new Error(
      `Failed to create read URL: ${error?.message ?? "Unknown error"}`
    );
  }

  const now = input.now ?? new Date();
  const expiresAt = new Date(
    now.getTime() + expiresInSeconds * 1000
  ).toISOString();

  return { url: data.signedUrl, expiresAt };
}

/**
 * Delete widget media objects (retention cron, PULSE-340/341). Every path is
 * validated against STORAGE_PATH_PATTERN first so a bad row cannot turn into
 * a wildcard delete. No-op for an empty list.
 */
export async function deleteWidgetObjects(
  paths: string[],
  storage?: WidgetStorageClient
): Promise<void> {
  if (paths.length === 0) return;

  const invalid = paths.find((p) => !STORAGE_PATH_PATTERN.test(p));
  if (invalid !== undefined) {
    throw new Error(`Invalid storage path: ${invalid}`);
  }

  const { error } = await storageClient(storage)
    .from(WIDGET_MEDIA_BUCKET)
    .remove(paths);

  if (error) {
    throw new Error(`Failed to delete widget objects: ${error.message}`);
  }
}
