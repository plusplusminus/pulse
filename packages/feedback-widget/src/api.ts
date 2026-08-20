import type { FeedbackPayload, SubmitResult } from './types'

export async function submitFeedback(
  apiUrl: string,
  siteKey: string,
  payload: FeedbackPayload
): Promise<SubmitResult> {
  const response = await fetch(`${apiUrl}/api/widget/feedback`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Site-Key': siteKey,
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' })) as { error?: string }
    throw new Error(error.error ?? `HTTP ${response.status}`)
  }

  return response.json() as Promise<SubmitResult>
}
