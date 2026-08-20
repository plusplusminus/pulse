"use client";

import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { linearImageComponents } from "@/lib/image-proxy";
import { FileText, X } from "lucide-react";

import type { ProjectDocument } from "./project-tabs";

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
}

export function DocumentModal({
  document: doc,
  onClose,
}: {
  document: ProjectDocument;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<Element | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement;

    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";

    // Focus the dialog container
    dialogRef.current?.focus();

    return () => {
      window.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
      // Restore focus to previously focused element
      if (previousFocusRef.current instanceof HTMLElement) {
        previousFocusRef.current.focus();
      }
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] px-4"
    >
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="document-modal-title"
        tabIndex={-1}
        className="relative bg-background rounded-xl border border-border shadow-xl w-full max-w-2xl max-h-[75vh] flex flex-col outline-none"
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-border shrink-0">
          <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
          {doc.icon && <span className="text-base shrink-0">{doc.icon}</span>}
          <h2 id="document-modal-title" className="text-sm font-semibold text-foreground truncate flex-1">{doc.title}</h2>
          <span className="text-[11px] text-muted-foreground shrink-0">
            Updated {formatDate(doc.updatedAt)}
          </span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1 -mr-1 rounded-md hover:bg-muted/50 transition-colors"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
        {/* Content */}
        <div className="flex-1 overflow-auto px-6 py-5">
          <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:text-sm prose-headings:font-semibold prose-headings:mt-6 prose-headings:mb-2 prose-p:text-[13px] prose-p:leading-relaxed prose-p:my-2.5 prose-code:text-xs prose-pre:text-xs prose-pre:my-3 prose-ul:text-[13px] prose-ul:my-2.5 prose-ol:text-[13px] prose-ol:my-2.5 prose-li:my-0.5 prose-hr:my-5">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={linearImageComponents}>
              {doc.content!}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
}
