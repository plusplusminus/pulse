"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { HubMemberRole } from "@/lib/supabase";

export type HubTeam = {
  id: string;
  name: string;
  key: string;
  color?: string;
  icon?: string;
};

export type HubContextValue = {
  hubId: string;
  hubSlug: string;
  hubName: string;
  teams: HubTeam[];
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: HubMemberRole;
  isViewOnly: boolean;
  isLoading: boolean;
  /** True if admin has connected their Linear account. Only set for admin role. */
  linearConnected?: boolean;
};

const HubContext = createContext<HubContextValue | null>(null);

/**
 * Combined hub context provider.
 * Server-side data (hubId, slug, name, teams) is passed directly.
 * Client-side data (user, role) is fetched from /api/hubs/[hubId]/me.
 */
export function HubProvider({
  hubId,
  hubSlug,
  hubName,
  teams,
  children,
}: {
  hubId: string;
  hubSlug: string;
  hubName: string;
  teams: HubTeam[];
  children: ReactNode;
}) {
  const [authState, setAuthState] = useState<{
    userId: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    role: HubMemberRole;
    isViewOnly: boolean;
    isLoading: boolean;
    linearConnected?: boolean;
  }>({
    userId: "",
    email: "",
    firstName: null,
    lastName: null,
    role: "default",
    isViewOnly: false,
    isLoading: true,
  });

  useEffect(() => {
    async function fetchMe() {
      try {
        const res = await fetch(`/api/hubs/${hubId}/me`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          userId: string;
          email: string;
          firstName: string | null;
          lastName: string | null;
          role: HubMemberRole;
          isViewOnly: boolean;
          linearConnected?: boolean;
        };
        setAuthState({
          userId: data.userId,
          email: data.email,
          firstName: data.firstName,
          lastName: data.lastName,
          role: data.role,
          isViewOnly: data.isViewOnly,
          isLoading: false,
          linearConnected: data.linearConnected,
        });
      } catch {
        setAuthState((prev) => ({ ...prev, isLoading: false }));
      }
    }
    fetchMe();
  }, [hubId]);

  return (
    <HubContext.Provider
      value={{
        hubId,
        hubSlug,
        hubName,
        teams,
        ...authState,
      }}
    >
      {children}
    </HubContext.Provider>
  );
}

export function useHub(): HubContextValue {
  const ctx = useContext(HubContext);
  if (!ctx) {
    throw new Error("useHub must be used within a HubProvider");
  }
  return ctx;
}
