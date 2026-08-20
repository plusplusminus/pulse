"use client";

import { useState } from "react";
import { FileText } from "lucide-react";

import { DocumentModal } from "./document-modal";

type CycleDocument = {
  id: string;
  title: string;
  content?: string;
  slugId: string;
  icon?: string;
  color?: string;
  updatedAt: string;
};

type CycleLink = {
  id: string;
  label: string;
  url: string;
  createdAt: string;
};

export function CycleCardPills({
  documents,
  links,
}: {
  documents: CycleDocument[];
  links: CycleLink[];
}) {
  const [openDoc, setOpenDoc] = useState<CycleDocument | null>(null);

  const safeLinks = links.flatMap((link) => {
    try {
      const parsed = new URL(link.url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return [];
      const hostname = parsed.hostname.replace(/^www\./, "");
      return [{ ...link, safeUrl: parsed.href, hostname, displayLabel: link.label || hostname || link.url }];
    } catch {
      return [];
    }
  });

  if (documents.length === 0 && safeLinks.length === 0) return null;

  return (
    <>
      <div className="flex flex-wrap gap-1.5 mt-2 ml-[26px]">
        {documents.map((doc) => (
          <button
            key={doc.id}
            disabled={!doc.content}
            onClick={() => doc.content && setOpenDoc(doc)}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-xs ${
              doc.content
                ? "hover:bg-muted/50 hover:border-border/80 transition-colors cursor-pointer"
                : "opacity-60 cursor-default"
            }`}
          >
            <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            {doc.icon && <span className="text-sm shrink-0">{doc.icon}</span>}
            <span className="text-foreground">{doc.title}</span>
          </button>
        ))}
        {safeLinks.map((link) => (
          <a
            key={link.id}
            href={link.safeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-xs hover:bg-muted/50 hover:border-border/80 transition-colors group"
          >
            <svg
              aria-hidden="true"
              className="w-3.5 h-3.5 text-muted-foreground shrink-0 group-hover:text-foreground transition-colors"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6.5 3.5H3.5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-3" />
              <path d="M9.5 2.5h4v4" />
              <path d="M13.5 2.5L7.5 8.5" />
            </svg>
            <span className="text-foreground">{link.displayLabel}</span>
            {link.hostname && link.displayLabel !== link.hostname && (
              <span className="text-muted-foreground text-[11px]">{link.hostname}</span>
            )}
          </a>
        ))}
      </div>

      {openDoc && (
        <DocumentModal document={openDoc} onClose={() => setOpenDoc(null)} />
      )}
    </>
  );
}
