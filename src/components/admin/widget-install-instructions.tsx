"use client";

import { useState } from "react";
import { Copy, Check, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface WidgetInstallInstructionsProps {
  /** Full site key. Only available in memory right after creation or rotation. */
  siteKey?: string;
  /** Stored prefix (sk_xxxxxxx). Shown as a placeholder when the full key is not in memory. */
  siteKeyPrefix: string;
  onRotate?: () => void;
  rotating?: boolean;
}

function pulseOrigin(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  return typeof window !== "undefined" ? window.location.origin : "";
}

export function WidgetInstallInstructions({
  siteKey,
  siteKeyPrefix,
  onRotate,
  rotating,
}: WidgetInstallInstructionsProps) {
  const hasFullKey = Boolean(siteKey);
  // Never fall back to the prefix: it is not a valid credential.
  const displayKey = siteKey ?? `${siteKeyPrefix}…`;
  const origin = pulseOrigin();
  const scriptUrl = `${origin}/widget/v1/pulse.js`;
  const loaderUrl = `${origin}/widget/v1/pulse-loader.js`;

  const scriptSnippet = `<script async src="${scriptUrl}" data-site="${displayKey}"></script>`;

  const cookieSnippet = `<!-- Cookie Mode: widget only loads when pulse_enabled=1 cookie is set -->
<script>
  window.PulseConfig = { siteKey: '${displayKey}' };
</script>
<script async src="${loaderUrl}"></script>

<!-- Enable via console: document.cookie = "pulse_enabled=1; path=/; max-age=31536000" -->`;

  const npmSnippet = `import { Pulse } from '@pulse/feedback-widget'

Pulse.init({
  siteKey: '${displayKey}',
})`;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Install Instructions</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Site key{" "}
            <code className="text-[11px] bg-muted px-1 rounded">
              {displayKey}
            </code>
            {hasFullKey
              ? " — copy the snippets now; the full key is not shown again after you leave this page."
              : " — the full key is only shown once at creation. Rotate to get a new key if you no longer have it."}
          </p>
        </div>
        {onRotate && (
          <button
            onClick={onRotate}
            disabled={rotating}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-background text-foreground hover:bg-accent/50 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", rotating && "animate-spin")} />
            Rotate key
          </button>
        )}
      </div>

      <div className="space-y-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">
            Script Tag
          </p>
          <CodeBlock code={scriptSnippet} copyable={hasFullKey} />
          <p className="text-[11px] text-muted-foreground mt-1.5">
            Screenshot capture and the screenshot editor are fetched on first
            use from{" "}
            <code className="text-[11px] bg-muted px-1 rounded">
              {origin}/widget/v1/capture-engine.js
            </code>{" "}
            and{" "}
            <code className="text-[11px] bg-muted px-1 rounded">
              {origin}/widget/v1/annotation-editor.js
            </code>
            , the same origin as the snippet above — if you run a Content
            Security Policy, the{" "}
            <code className="text-[11px] bg-muted px-1 rounded">script-src</code>{" "}
            entry that allows{" "}
            <code className="text-[11px] bg-muted px-1 rounded">{origin}</code>{" "}
            already covers it. No extra directive is needed.
          </p>
        </div>

        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">
            Cookie Mode (Internal / QA)
          </p>
          <p className="text-[11px] text-muted-foreground mb-1.5">
            Only loads the widget when <code className="text-[11px] bg-muted px-1 rounded">pulse_enabled=1</code> cookie is set. Drag the bookmarklet below to your bookmarks bar to toggle.
          </p>
          <CodeBlock code={cookieSnippet} copyable={hasFullKey} />
          <Bookmarklet />
        </div>

        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">
            NPM Package
          </p>
          <CodeBlock code="npm install @pulse/feedback-widget" copyable />
          <div className="mt-1.5">
            <CodeBlock code={npmSnippet} copyable={hasFullKey} />
          </div>
        </div>
      </div>
    </div>
  );
}

const BOOKMARKLET_CODE = `javascript:void(function(){var c='pulse_enabled',on=/(?:^|;\\s*)pulse_enabled=1/.test(document.cookie);document.cookie=c+'='+(on?';max-age=0':'1;max-age=31536000')+';path=/';var s=on?'OFF':'ON';var d=document.createElement('div');d.textContent='Pulse '+s;d.style.cssText='position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;padding:8px 16px;border-radius:6px;font:600 13px/1 system-ui,sans-serif;color:#fff;background:'+(on?'%23666':'%234f46e5')+';box-shadow:0 2px 8px rgba(0,0,0,.15);transition:opacity .3s';document.body.appendChild(d);setTimeout(function(){d.style.opacity='0'},1200);setTimeout(function(){d.remove();location.reload()},1600)}())`;

function Bookmarklet() {
  return (
    <div className="mt-2 flex items-center gap-2">
      <a
        href={BOOKMARKLET_CODE}
        onClick={(e) => e.preventDefault()}
        draggable
        className={cn(
          "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md",
          "bg-primary text-primary-foreground",
          "hover:bg-primary/90 cursor-grab active:cursor-grabbing",
          "border border-primary/20 shadow-sm"
        )}
      >
        Toggle Pulse
      </a>
      <span className="text-[11px] text-muted-foreground">
        Drag this to your bookmarks bar
      </span>
    </div>
  );
}

function CodeBlock({ code, copyable }: { code: string; copyable: boolean }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group">
      <pre className="text-xs bg-muted/50 border border-border rounded-md p-3 overflow-x-auto font-mono">
        {code}
      </pre>
      <button
        onClick={handleCopy}
        disabled={!copyable}
        className={cn(
          "absolute top-2 right-2 p-1.5 rounded-md border border-border bg-background text-muted-foreground",
          "opacity-0 group-hover:opacity-100 transition-opacity",
          "hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-muted-foreground"
        )}
        title={copyable ? "Copy to clipboard" : "Full key not available — rotate the key to get a new one"}
      >
        {copied ? (
          <Check className="w-3.5 h-3.5 text-green-500" />
        ) : (
          <Copy className="w-3.5 h-3.5" />
        )}
      </button>
    </div>
  );
}
