"use client";

import { useState, useEffect, useTransition } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Check, Unplug, Users, KeyRound } from "lucide-react";

interface OAuthStatus {
  configured: boolean;
  app?: { name: string | null };
  clientId?: string | null;
  connectedAt?: string | null;
}

export function OAuthConnectionForm() {
  const [status, setStatus] = useState<OAuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    fetchStatus();
  }, []);

  async function fetchStatus() {
    try {
      const res = await fetch("/api/admin/workspace/oauth");
      if (!res.ok) throw new Error("Failed to fetch");
      const data: OAuthStatus = await res.json();
      setStatus(data);
    } catch {
      setStatus({ configured: false });
    } finally {
      setLoading(false);
    }
  }

  function connect() {
    if (!clientId.trim() || !clientSecret.trim()) return;

    startTransition(async () => {
      try {
        const res = await fetch("/api/admin/workspace/oauth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: clientId.trim(),
            clientSecret: clientSecret.trim(),
          }),
        });
        if (!res.ok) {
          const err = (await res.json()) as { error?: string };
          throw new Error(err.error ?? "Failed to connect");
        }
        toast.success("Linear OAuth app connected");
        setClientId("");
        setClientSecret("");
        await fetchStatus();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to connect");
      }
    });
  }

  function disconnect() {
    if (
      !confirm(
        "Disconnect the Linear OAuth app? Client comments will revert to showing the workspace token owner's name in Linear."
      )
    ) {
      return;
    }

    startTransition(async () => {
      try {
        const res = await fetch("/api/admin/workspace/oauth", {
          method: "DELETE",
        });
        if (!res.ok) throw new Error("Failed to disconnect");
        toast.success("Linear OAuth app disconnected");
        await fetchStatus();
      } catch {
        toast.error("Failed to disconnect");
      }
    });
  }

  if (loading) {
    return (
      <div className="max-w-lg">
        <h2 className="text-lg font-semibold mb-4">Linear OAuth App</h2>
        <div className="h-32 rounded-lg bg-muted/50 animate-pulse" />
      </div>
    );
  }

  const connected = status?.configured ?? false;

  return (
    <div className="max-w-lg">
      <h2 className="text-lg font-semibold mb-1">Linear OAuth App</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Configure the OAuth app that powers client attribution and admin account
        linking. Client comments and issues will show the author&apos;s name in
        Linear, and admins can connect their personal Linear accounts below.
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
                <p className="text-sm font-medium">OAuth App Connected</p>
                <p className="text-xs text-muted-foreground">
                  {status?.app?.name ?? "Linear OAuth App"}
                </p>
              </div>
            </div>

            <div className="space-y-1.5 text-xs text-muted-foreground">
              {status?.clientId && (
                <div className="flex items-center gap-1.5">
                  <KeyRound className="w-3 h-3" />
                  <span className="font-mono">{status.clientId}</span>
                </div>
              )}
              {status?.connectedAt && (
                <p>
                  Connected {new Date(status.connectedAt).toLocaleDateString()} at{" "}
                  {new Date(status.connectedAt).toLocaleTimeString()}
                </p>
              )}
            </div>

            <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/50 rounded px-2.5 py-1.5">
              <Users className="w-3.5 h-3.5 shrink-0" />
              <span>
                Client comments and issues appear as &ldquo;Client Name (via{" "}
                {status?.app?.name ?? "your app"})&rdquo; in Linear
              </span>
            </div>
          </div>

          {/* Disconnect */}
          <div className="border border-destructive/30 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Unplug className="w-4 h-4 text-destructive" />
              <p className="text-sm font-medium">Disconnect OAuth App</p>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Client comments will revert to showing the workspace token owner&apos;s
              name in Linear.
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
      ) : (
        /* Disconnected state */
        <div className="border border-border rounded-lg p-6 bg-card">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
              <Users className="w-4 h-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">Not connected</p>
              <p className="text-xs text-muted-foreground">
                Enter your Linear OAuth app credentials
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label htmlFor="clientId" className="block text-xs font-medium mb-1">
                Client ID
              </label>
              <input
                id="clientId"
                type="text"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="Your OAuth app Client ID"
                className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background font-mono focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent placeholder:text-muted-foreground/60"
              />
            </div>

            <div>
              <label htmlFor="clientSecret" className="block text-xs font-medium mb-1">
                Client Secret
              </label>
              <input
                id="clientSecret"
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder="Your OAuth app Client Secret"
                className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background font-mono focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent placeholder:text-muted-foreground/60"
              />
            </div>

            <p className="text-[10px] text-muted-foreground">
              Create an OAuth app at Linear Settings → API → OAuth Applications.
              Enable &ldquo;Client credentials&rdquo; in the app settings.
            </p>

            <button
              onClick={connect}
              disabled={!clientId.trim() || !clientSecret.trim() || isPending}
              className={cn(
                "w-full px-4 py-2 text-sm font-medium rounded-md transition-colors",
                clientId.trim() && clientSecret.trim()
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-muted text-muted-foreground cursor-not-allowed"
              )}
            >
              {isPending ? "Validating..." : "Connect"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
