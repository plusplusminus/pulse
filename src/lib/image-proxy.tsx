import type { Components } from "react-markdown";
import { File, FileText, FileSpreadsheet, Image, Archive } from "lucide-react";

const LINEAR_CDN_HOSTS = new Set([
  "uploads.linear.app",
  "linear-uploads.s3.amazonaws.com",
  "public-files.linear.app",
]);

/**
 * Check if a URL is hosted on Linear's CDN.
 */
export function isLinearCdnUrl(url: string): boolean {
  try {
    return LINEAR_CDN_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** @deprecated Use isLinearCdnUrl */
export const isLinearImageUrl = isLinearCdnUrl;

/**
 * Rewrite a Linear CDN URL to go through our server-side proxy.
 * Non-Linear URLs are returned unchanged.
 */
export function proxyLinearUrl(src: string): string {
  if (!isLinearCdnUrl(src)) return src;
  return `/api/image-proxy?url=${encodeURIComponent(src)}`;
}

/** @deprecated Use proxyLinearUrl */
export const proxyLinearImageUrl = proxyLinearUrl;

const FILE_ICON_MAP: Record<string, typeof File> = {
  pdf: FileText,
  doc: FileText,
  docx: FileText,
  txt: FileText,
  rtf: FileText,
  xls: FileSpreadsheet,
  xlsx: FileSpreadsheet,
  csv: FileSpreadsheet,
  zip: Archive,
  rar: Archive,
  "7z": Archive,
  gz: Archive,
  tar: Archive,
  png: Image,
  jpg: Image,
  jpeg: Image,
  gif: Image,
  webp: Image,
  svg: Image,
};

export function getFileIcon(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return FILE_ICON_MAP[ext] ?? File;
}

function filenameFromUrl(href: string, children: React.ReactNode): string {
  const childText = typeof children === "string" ? children.trim() : "";
  if (childText) return childText;
  try {
    const pathname = new URL(href).pathname;
    return decodeURIComponent(pathname.split("/").pop() ?? "Download file");
  } catch {
    return "Download file";
  }
}

/**
 * Shared ReactMarkdown components that proxy Linear CDN images and file links.
 * Use as: <ReactMarkdown components={linearImageComponents} ...>
 */
export const linearImageComponents: Components = {
  img: ({ src, ...props }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...props}
      src={typeof src === "string" ? proxyLinearUrl(src) : undefined}
      alt={props.alt ?? ""}
    />
  ),
  a: ({ href, children, ...props }) => {
    if (href && isLinearCdnUrl(href)) {
      const displayName = filenameFromUrl(href, children);
      const IconComponent = getFileIcon(displayName);
      return (
        <a
          href={proxyLinearUrl(href)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-border bg-muted/50 hover:bg-muted text-foreground no-underline transition-colors text-xs"
          {...props}
        >
          <IconComponent className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <span className="truncate max-w-[200px]">{displayName}</span>
        </a>
      );
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
        {children}
      </a>
    );
  },
};
