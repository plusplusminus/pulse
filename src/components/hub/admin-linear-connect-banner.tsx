"use client";

import Link from "next/link";
import { Unplug } from "lucide-react";

/**
 * Inline banner shown to PPM admins who haven't connected their Linear
 * account yet. Replaces the comment composer or issue-creation controls
 * until they complete the OAuth connection.
 */
export function AdminLinearConnectBanner({
  context = "default",
}: {
  /** Adjusts the copy slightly depending on where the banner appears */
  context?: "comment" | "issue" | "default";
}) {
  const contextLabel =
    context === "comment"
      ? "post comments"
      : context === "issue"
        ? "submit requests"
        : "create issues or comments";

  return (
    <div className="border-t border-border p-4 shrink-0">
      <div className="flex items-start gap-3 rounded-md border border-border bg-muted/50 px-4 py-3">
        <Unplug className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-foreground">
            Connect your Linear account to {contextLabel}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Your comments and issues will be attributed to your Linear identity.
          </p>
          <Link
            href="/admin/settings/linear"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 mt-2 transition-colors"
          >
            Connect in admin settings
            <span aria-hidden="true">&rarr;</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
