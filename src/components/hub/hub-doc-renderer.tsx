"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { linearImageComponents } from "@/lib/image-proxy";

export function HubDocRenderer({ content }: { content: string }) {
  return (
    <article className="prose prose-sm prose-neutral dark:prose-invert max-w-none
      prose-headings:font-semibold prose-headings:tracking-tight
      prose-h1:text-lg prose-h1:mb-4 prose-h1:mt-0
      prose-h2:text-base prose-h2:mt-8 prose-h2:mb-3
      prose-h3:text-sm prose-h3:mt-6 prose-h3:mb-2
      prose-p:text-sm prose-p:leading-relaxed prose-p:text-muted-foreground
      prose-li:text-sm prose-li:text-muted-foreground
      prose-strong:text-foreground prose-strong:font-medium
      prose-code:text-xs prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded
      prose-table:text-sm
      prose-th:text-xs prose-th:font-medium prose-th:text-muted-foreground prose-th:uppercase prose-th:tracking-wider
      prose-td:text-sm prose-td:text-muted-foreground
      prose-hr:border-border
      prose-a:text-primary prose-a:no-underline hover:prose-a:underline
      prose-img:rounded-lg prose-img:border prose-img:border-border prose-img:shadow-sm prose-img:my-4
      prose-em:text-xs prose-em:text-muted-foreground/70
    ">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={linearImageComponents}>{content}</ReactMarkdown>
    </article>
  );
}
