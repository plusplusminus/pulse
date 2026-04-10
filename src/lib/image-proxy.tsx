import type { Components } from "react-markdown";

const LINEAR_CDN_HOSTS = new Set([
  "uploads.linear.app",
  "linear-uploads.s3.amazonaws.com",
  "public-files.linear.app",
]);

/**
 * Check if a URL is hosted on Linear's CDN.
 */
export function isLinearImageUrl(url: string): boolean {
  try {
    return LINEAR_CDN_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Rewrite a Linear CDN image URL to go through our server-side proxy.
 * Non-Linear URLs are returned unchanged.
 */
export function proxyLinearImageUrl(src: string): string {
  if (!isLinearImageUrl(src)) return src;
  return `/api/image-proxy?url=${encodeURIComponent(src)}`;
}

/**
 * Shared ReactMarkdown components that proxy Linear CDN images.
 * Use as: <ReactMarkdown components={linearImageComponents} ...>
 */
export const linearImageComponents: Components = {
  img: ({ src, ...props }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...props}
      src={typeof src === "string" ? proxyLinearImageUrl(src) : undefined}
      alt={props.alt ?? ""}
    />
  ),
};
