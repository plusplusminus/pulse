"use client";

import { useState, useEffect, useTransition } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Unplug, User, ExternalLink } from "lucide-react";

interface AdminLinearStatus {
  connected: boolean;
  linearUserName: string | null;
  linearUserEmail: string | null;
  connectedAt: string | null;
}

interface OAuthAppStatus {
  configured: boolean;
}

export function AdminLinearConnection() {
  const [status, setStatus] = useState<AdminLinearStatus | null>(null);
  const [oauthAppConfigured, setOauthAppConfigured] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    fetchStatus();
  }, []);

  // Handle callback URL params
  useEffect(() => {
    const connected = searchParams.get("linear_connected");
    const error = searchParams.get("linear_error");

    if (connected === "true") {
      toast.success("Linear account connected successfully");
      cleanUpParams();
    } else if (error) {
      toast.error(decodeURIComponent(error));
      cleanUpParams();
    }
  }, [searchParams]);

  function cleanUpParams() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("linear_connected");
    params.delete("linear_error");
    const remaining = params.toString();
    router.replace(
      `/admin/settings/linear${remaining ? `?${remaining}` : ""}`,
      { scroll: false }
    );
  }

  async function fetchStatus() {
    try {
      // Check both the per-user status and whether the OAuth app is configured
      const [statusRes, oauthRes] = await Promise.all([
        fetch("/api/admin/oauth/linear/status"),
        fetch("/api/admin/workspace/oauth"),
      ]);

      if (statusRes.ok) {
        const data: AdminLinearStatus = await statusRes.json();
        setStatus(data);
      } else {
        setStatus({ connected: false, linearUserName: null, linearUserEmail: null, connectedAt: null });
      }

      if (oauthRes.ok) {
        const oauthData: OAuthAppStatus = await oauthRes.json();
        setOauthAppConfigured(oauthData.configured);
      } else {
        setOauthAppConfigured(false);
      }
    } catch {
      setStatus({ connected: false, linearUserName: null, linearUserEmail: null, connectedAt: null });
      setOauthAppConfigured(false);
    } finally {
      setLoading(false);
    }
  }

  function disconnect() {
    if (
      !confirm(
        "Disconnect your personal Linear account? Your comments and issues will revert to appearing as an external actor in Linear."
      )
    ) {
      return;
    }

    startTransition(async () => {
      try {
        const res = await fetch("/api/admin/oauth/linear/disconnect", {
          method: "DELETE",
        });
        if (!res.ok) throw new Error("Failed to disconnect");
        toast.success("Linear account disconnected");
        await fetchStatus();
      } catch {
        toast.error("Failed to disconnect");
      }
    });
  }

  if (loading) {
    return (
      <div className="max-w-lg">
        <h2 className="text-lg font-semibold mb-4">Your Linear Account</h2>
        <div className="h-32 rounded-lg bg-muted/50 animate-pulse" />
      </div>
    );
  }

  const connected = status?.connected ?? false;

  return (
    <div className="max-w-lg">
      <h2 className="text-lg font-semibold mb-1">Your Linear Account</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Connect your Linear account so your comments and issues appear as you in
        Linear, not as an external actor.
      </p>

      {connected ? (
        <div className="space-y-4">
          {/* Connected state */}
          <div className="border border-border rounded-lg p-4 bg-card">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-8 h-8 rounded-full bg-[var(--badge-green-bg)] flex items-center justify-center">
                <Check className="w-4 h-4 text-[var(--badge-green-text)]" />
              </div>
              <div>
                <p className="text-sm font-medium">Connected</p>
                <p className="text-xs text-muted-foreground">
                  {status?.linearUserName ?? status?.linearUserEmail ?? "Linear account"}
                </p>
              </div>
            </div>

            <div className="space-y-1.5 text-xs text-muted-foreground">
              {status?.linearUserName && status?.linearUserEmail && (
                <p>{status.linearUserEmail}</p>
              )}
              {status?.connectedAt && (
                <p>
                  Connected {new Date(status.connectedAt).toLocaleDateString()} at{" "}
                  {new Date(status.connectedAt).toLocaleTimeString()}
                </p>
              )}
            </div>

            <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/50 rounded px-2.5 py-1.5">
              <User className="w-3.5 h-3.5 shrink-0" />
              <span>
                Issues and comments you create from the hub will appear as your
                Linear identity
              </span>
            </div>
          </div>

          {/* Disconnect */}
          <div className="border border-destructive/30 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Unplug className="w-4 h-4 text-destructive" />
              <p className="text-sm font-medium">Disconnect Account</p>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Your comments and issues will revert to appearing as an external
              actor in Linear.
            </p>
            <button
              onClick={disconnect}
              disabled={isPending}
              className="px-3 py-1.5 text-sm font-medium rounded-md bg-destructive text-white hover:bg-destructive/90 transition-colors disabled:opacity-50"
            >
              {isPending ? "Disconnecting..." : "Disconnect"}
            </button>
          </div>
        </div>
      ) : oauthAppConfigured === false ? (
        /* OAuth app not configured — show dependency message */
        <div className="border border-border rounded-lg p-6 bg-card">
          <div className="flex items-center gap-2.5 mb-3">
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
              <User className="w-4 h-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">Not available</p>
              <p className="text-xs text-muted-foreground">
                Requires the Linear OAuth App to be configured first
              </p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Set up the <span className="font-medium text-foreground">Linear OAuth App</span> section
            above, then return here to connect your personal account.
          </p>
        </div>
      ) : (
        /* Disconnected state — OAuth app is configured, ready to connect */
        <div className="border border-border rounded-lg p-6 bg-card">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
              <User className="w-4 h-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">Not connected</p>
              <p className="text-xs text-muted-foreground">
                Sign in with Linear to link your account
              </p>
            </div>
          </div>

          <a
            href="/api/admin/oauth/linear/authorize"
            className="flex items-center justify-center gap-2 w-full px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Connect to Linear
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      )}
    </div>
  );
}
