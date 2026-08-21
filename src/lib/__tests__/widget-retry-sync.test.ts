import { afterEach, describe, expect, it, vi } from "vitest";
import { retrySubmissionSync } from "../widget-retry-sync";

const SUBMISSION_ID = "11111111-2222-3333-4444-555555555555";

function mockFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("retrySubmissionSync", () => {
  it("POSTs to the retry endpoint and resolves on success", async () => {
    const fetchMock = mockFetch(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    await expect(retrySubmissionSync(SUBMISSION_ID)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/widget/submissions/${SUBMISSION_ID}/retry`,
      { method: "POST" }
    );
  });

  it("surfaces the server's error message on a JSON error body", async () => {
    mockFetch(
      new Response(JSON.stringify({ error: "Linear rejected the issue" }), {
        status: 502,
      })
    );

    await expect(retrySubmissionSync(SUBMISSION_ID)).rejects.toThrow(
      "Linear rejected the issue"
    );
  });

  it("falls back to 'Retry failed' when the error body is not JSON", async () => {
    // An edge/proxy 502 carries an HTML body; a bare res.json() throws a
    // SyntaxError here and the user sees "Unexpected token '<'".
    mockFetch(
      new Response("<html><body>502 Bad Gateway</body></html>", {
        status: 502,
        headers: { "Content-Type": "text/html" },
      })
    );

    await expect(retrySubmissionSync(SUBMISSION_ID)).rejects.toThrow(
      "Retry failed"
    );
  });

  it("falls back to 'Retry failed' on an empty error body", async () => {
    mockFetch(new Response(null, { status: 500 }));

    await expect(retrySubmissionSync(SUBMISSION_ID)).rejects.toThrow(
      "Retry failed"
    );
  });
});
