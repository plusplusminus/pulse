"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface WidgetInstallInstructionsProps {
  apiKey?: string;
  apiKeyPrefix?: string;
}

export function WidgetInstallInstructions({
  apiKey,
  apiKeyPrefix,
}: WidgetInstallInstructionsProps) {
  const displayKey = apiKey || apiKeyPrefix || "wk_YOUR_KEY";

  const scriptSnippet = `<script>
  (function(w,d,s,k){
    w.PulseConfig={widgetKey:k};
    var f=d.getElementsByTagName(s)[0],
        j=d.createElement(s);
    j.async=1;
    j.src='https://r2.lineargratis.com/widget/v1/pulse.js';
    f.parentNode.insertBefore(j,f);
  })(window,document,'script','${displayKey}');
</script>`;

  const cookieSnippet = `<!-- Cookie Mode: widget only loads when pulse_enabled=1 cookie is set -->
<script>
  window.PulseConfig = { widgetKey: '${displayKey}' };
</script>
<script async src="https://r2.lineargratis.com/widget/v1/pulse-loader.js"></script>

<!-- Enable via console: document.cookie = "pulse_enabled=1; path=/; max-age=31536000" -->`;

  const npmSnippet = `import { Pulse } from '@pulse/feedback-widget'

Pulse.init({
  widgetKey: '${displayKey}',
})`;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">Install Instructions</h3>

      <div className="space-y-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">
            Script Tag
          </p>
          <CodeBlock code={scriptSnippet} />
        </div>

        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">
            Cookie Mode (Internal / QA)
          </p>
          <p className="text-[11px] text-muted-foreground mb-1.5">
            Only loads the widget when <code className="text-[11px] bg-muted px-1 rounded">pulse_enabled=1</code> cookie is set. Drag the bookmarklet below to your bookmarks bar to toggle.
          </p>
          <CodeBlock code={cookieSnippet} />
          <Bookmarklet />
        </div>

        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">
            NPM Package
          </p>
          <CodeBlock code="npm install @pulse/feedback-widget" />
          <div className="mt-1.5">
            <CodeBlock code={npmSnippet} />
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

function CodeBlock({ code }: { code: string }) {
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
        className={cn(
          "absolute top-2 right-2 p-1.5 rounded-md border border-border bg-background text-muted-foreground",
          "opacity-0 group-hover:opacity-100 transition-opacity",
          "hover:text-foreground"
        )}
        title="Copy to clipboard"
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
