/**
 * Build the correct Authorization header for a Linear token.
 * API keys (lin_api_...) must NOT use the Bearer prefix.
 * OAuth tokens require the Bearer prefix.
 */
export function linearAuthHeader(token: string): string {
  return token.startsWith("lin_api_") ? token : `Bearer ${token}`;
}
