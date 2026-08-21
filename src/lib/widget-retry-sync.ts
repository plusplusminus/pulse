/**
 * PULSE-347 — retry the Linear sync for one widget submission.
 *
 * Shared by the submissions table and the submission detail view so both report
 * failures identically. The error body is parsed defensively: a 502 from the
 * edge carries an HTML body, and a bare `res.json()` throws a SyntaxError there,
 * surfacing `Unexpected token '<'` to the user instead of the real failure.
 */
export async function retrySubmissionSync(submissionId: string): Promise<void> {
  const res = await fetch(`/api/widget/submissions/${submissionId}/retry`, {
    method: "POST",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Retry failed");
  }
}
