/**
 * Widget transport: uploadBlob (ticket -> signed PUT / TUS) and the minimal
 * TUS client, driven through a fake XMLHttpRequest + fetch so the protocol
 * shape is pinned without a browser or a live Supabase (PULSE-323).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UploadError, uploadBlob } from "./upload";
import { tusUpload } from "./tus";

type Recorded = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: Blob | null;
};

type Reply =
  | { status: number; headers?: Record<string, string> }
  | { networkError: true };

type Handler = (req: Recorded, index: number) => Reply;

let handler: Handler = () => ({ status: 500 });
const requests: Recorded[] = [];

class FakeXHR {
  method = "";
  url = "";
  headers: Record<string, string> = {};
  status = 0;
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  private responseHeaders: Record<string, string> = {};

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name.toLowerCase()] = value;
  }
  getResponseHeader(name: string) {
    return this.responseHeaders[name.toLowerCase()] ?? null;
  }
  send(body: Blob | null) {
    const record: Recorded = {
      method: this.method,
      url: this.url,
      headers: this.headers,
      body,
    };
    requests.push(record);
    const reply = handler(record, requests.length - 1);
    setTimeout(() => {
      if ("networkError" in reply) {
        this.onerror?.();
        return;
      }
      if (body) {
        this.upload.onprogress?.({
          lengthComputable: true,
          loaded: body.size,
          total: body.size,
        });
      }
      this.status = reply.status;
      this.responseHeaders = Object.fromEntries(
        Object.entries(reply.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])
      );
      this.onload?.();
    }, 0);
  }
}

const API = "https://pulse.test";
const KEY = "wk_test";
const HUB = "11111111-1111-1111-1111-111111111111";
const STORAGE = "https://proj.supabase.co/storage/v1";

function ticket(kind: "screenshots" | "videos", ext: string) {
  const storagePath = `${HUB}/${kind}/abc.${ext}`;
  return {
    uploadUrl: `${STORAGE}/object/upload/sign/widget-media/${storagePath}?token=tok123`,
    token: "tok123",
    storagePath,
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    resumableEndpoint: `${STORAGE}/upload/resumable`,
    bucket: "widget-media",
    maxBytes: 100 * 1024 * 1024,
  };
}

function mockTicketResponse(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status }))
  );
}

const MB = 1024 * 1024;

beforeEach(() => {
  requests.length = 0;
  handler = () => ({ status: 500 });
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uploadBlob", () => {
  it("requests a ticket with kind, contentType and sizeBytes", async () => {
    mockTicketResponse(ticket("screenshots", "png"));
    handler = () => ({ status: 200 });
    const blob = new Blob([new Uint8Array(1024)], { type: "image/png" });

    await uploadBlob(API, KEY, "screenshot", blob);

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API}/api/widget/upload`);
    expect((init.headers as Record<string, string>)["X-Site-Key"]).toBe(KEY);
    expect(JSON.parse(init.body as string)).toEqual({
      kind: "screenshot",
      contentType: "image/png",
      sizeBytes: 1024,
    });
  });

  it("PUTs small blobs straight to the signed URL and resolves the storagePath", async () => {
    const t = ticket("screenshots", "png");
    mockTicketResponse(t);
    handler = () => ({ status: 200 });
    const blob = new Blob([new Uint8Array(2 * MB)], { type: "image/png" });
    const progress: Array<[number, number]> = [];

    const storagePath = await uploadBlob(API, KEY, "screenshot", blob, {
      onProgress: (sent, total) => progress.push([sent, total]),
    });

    expect(storagePath).toBe(t.storagePath);
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe("PUT");
    expect(requests[0].url).toBe(t.uploadUrl);
    expect(requests[0].headers["content-type"]).toBe("image/png");
    expect(requests[0].body?.size).toBe(2 * MB);
    expect(progress.at(-1)).toEqual([2 * MB, 2 * MB]);
  });

  it("strips codec parameters from the Content-Type sent to Storage, not the ticket", async () => {
    const t = ticket("videos", "webm");
    mockTicketResponse(t);
    handler = () => ({ status: 200 });
    const blob = new Blob([new Uint8Array(1 * MB)], {
      type: "video/webm;codecs=vp9,opus",
    });

    await uploadBlob(API, KEY, "video", blob);

    // The ticket keeps the recorder's own label...
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).contentType).toBe("video/webm;codecs=vp9,opus");
    // ...but Storage matches its bucket allowlist exactly and 415s on parameters.
    expect(requests[0].headers["content-type"]).toBe("video/webm");
  });

  it("strips codec parameters from the resumable TUS metadata too", async () => {
    const t = ticket("videos", "webm");
    mockTicketResponse(t);
    handler = (req, i): Reply => {
      if (i === 0) {
        return {
          status: 201,
          headers: { Location: `${STORAGE}/upload/resumable/upload-1` },
        };
      }
      const offset = Number(req.headers["upload-offset"]);
      return {
        status: 204,
        headers: { "Upload-Offset": String(offset + (req.body?.size ?? 0)) },
      };
    };
    const blob = new Blob([new Uint8Array(7 * MB)], {
      type: "video/webm;codecs=vp8,opus",
    });

    await uploadBlob(API, KEY, "video", blob);

    const metadata = Object.fromEntries(
      requests[0].headers["upload-metadata"].split(",").map((pair) => {
        const [k, v] = pair.split(" ");
        return [k, Buffer.from(v, "base64").toString("utf8")];
      })
    );
    expect(metadata.contentType).toBe("video/webm");
  });

  it("uses the TUS endpoint with x-signature for blobs above 6 MB", async () => {
    const t = ticket("videos", "webm");
    mockTicketResponse(t);
    handler = (req, i): Reply => {
      if (i === 0) {
        return {
          status: 201,
          headers: { Location: `${STORAGE}/upload/resumable/upload-1` },
        };
      }
      const offset = Number(req.headers["upload-offset"]);
      return {
        status: 204,
        headers: { "Upload-Offset": String(offset + (req.body?.size ?? 0)) },
      };
    };
    const blob = new Blob([new Uint8Array(7 * MB)], { type: "video/webm" });
    const progress: Array<[number, number]> = [];

    const storagePath = await uploadBlob(API, KEY, "video", blob, {
      onProgress: (sent, total) => progress.push([sent, total]),
    });

    expect(storagePath).toBe(t.storagePath);
    expect(requests.map((r) => r.method)).toEqual(["POST", "PATCH", "PATCH"]);

    const create = requests[0];
    expect(create.url).toBe(t.resumableEndpoint);
    expect(create.headers["x-signature"]).toBe("tok123");
    expect(create.headers["tus-resumable"]).toBe("1.0.0");
    expect(create.headers["upload-length"]).toBe(String(7 * MB));
    const metadata = Object.fromEntries(
      create.headers["upload-metadata"].split(",").map((pair) => {
        const [k, v] = pair.split(" ");
        return [k, Buffer.from(v, "base64").toString("utf8")];
      })
    );
    expect(metadata).toEqual({
      bucketName: "widget-media",
      objectName: t.storagePath,
      contentType: "video/webm",
      cacheControl: "3600",
    });

    expect(requests[1].url).toBe(`${STORAGE}/upload/resumable/upload-1`);
    expect(requests[1].headers["upload-offset"]).toBe("0");
    expect(requests[1].headers["content-type"]).toBe("application/offset+octet-stream");
    expect(requests[1].headers["x-signature"]).toBe("tok123");
    expect(requests[1].body?.size).toBe(6 * MB);
    expect(requests[2].headers["upload-offset"]).toBe(String(6 * MB));
    expect(requests[2].body?.size).toBe(1 * MB);
    expect(progress.at(-1)).toEqual([7 * MB, 7 * MB]);
  });

  it("rejects with the server's message when the ticket is refused, without uploading", async () => {
    mockTicketResponse({ error: "screenshot exceeds the 10MB size limit" }, 413);
    const blob = new Blob([new Uint8Array(10)], { type: "image/png" });

    const err = await uploadBlob(API, KEY, "screenshot", blob).catch((e) => e);

    expect(err).toBeInstanceOf(UploadError);
    expect(err.message).toBe("screenshot exceeds the 10MB size limit");
    expect(err.step).toBe("ticket");
    expect(err.status).toBe(413);
    expect(requests).toHaveLength(0);
  });

  it("rejects when the signed PUT fails", async () => {
    mockTicketResponse(ticket("screenshots", "png"));
    handler = () => ({ status: 403 });
    const blob = new Blob([new Uint8Array(10)], { type: "image/png" });

    const err = await uploadBlob(API, KEY, "screenshot", blob).catch((e) => e);

    expect(err).toBeInstanceOf(UploadError);
    expect(err.step).toBe("put");
    expect(err.status).toBe(403);
  });

  it("rejects a blob with no content type before asking for a ticket", async () => {
    mockTicketResponse(ticket("screenshots", "png"));
    const blob = new Blob([new Uint8Array(10)]);

    await expect(uploadBlob(API, KEY, "screenshot", blob)).rejects.toThrow(
      /content type/
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("tusUpload", () => {
  const opts = {
    endpoint: `${STORAGE}/upload/resumable`,
    headers: { "x-signature": "tok" },
    metadata: { bucketName: "widget-media", objectName: `${HUB}/videos/a.webm` },
    chunkSize: 4,
    retryDelayMs: 0,
  };

  it("resumes from the server offset after a failed chunk", async () => {
    let patches = 0;
    handler = (req): Reply => {
      if (req.method === "POST") {
        return { status: 201, headers: { Location: "/upload/resumable/u2" } };
      }
      if (req.method === "HEAD") {
        return { status: 200, headers: { "Upload-Offset": "4" } };
      }
      patches++;
      if (patches === 2) return { networkError: true };
      const offset = Number(req.headers["upload-offset"]);
      return {
        status: 204,
        headers: { "Upload-Offset": String(offset + (req.body?.size ?? 0)) },
      };
    };
    const blob = new Blob([new Uint8Array(10)]);

    await tusUpload(blob, opts);

    expect(requests.map((r) => r.method)).toEqual([
      "POST",
      "PATCH", // 0-4 ok
      "PATCH", // 4-8 network error
      "HEAD", // server says 4
      "PATCH", // 4-8 again
      "PATCH", // 8-10
    ]);
    // Relative Location resolved against the endpoint origin.
    expect(requests[1].url).toBe("https://proj.supabase.co/upload/resumable/u2");
    expect(requests[4].headers["upload-offset"]).toBe("4");
    expect(requests[5].headers["upload-offset"]).toBe("8");
  });

  it("gives up after the retry budget", async () => {
    handler = (req): Reply =>
      req.method === "POST"
        ? { status: 201, headers: { Location: "/u3" } }
        : req.method === "HEAD"
          ? { status: 200, headers: { "Upload-Offset": "0" } }
          : { networkError: true };
    const blob = new Blob([new Uint8Array(3)]);

    await expect(tusUpload(blob, { ...opts, retries: 2 })).rejects.toThrow(
      /network error/
    );
    expect(requests.filter((r) => r.method === "PATCH")).toHaveLength(3);
  });

  it("fails when creation is refused", async () => {
    handler = () => ({ status: 403 });
    await expect(
      tusUpload(new Blob([new Uint8Array(3)]), opts)
    ).rejects.toThrow(/HTTP 403/);
  });
});
