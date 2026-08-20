import { useHub } from "@/contexts/hub-context";

/**
 * Returns whether the current user is a PPM admin who has NOT yet
 * connected their Linear account. When true, write operations
 * (issue creation, commenting) should be blocked with a prompt
 * to connect their account.
 *
 * Returns false for non-admin users (they are never blocked).
 */
export function useAdminLinearGate(): {
  /** True if this admin needs to connect Linear before writing */
  blocked: boolean;
  /** True while hub auth state is still loading */
  isLoading: boolean;
} {
  const { role, linearConnected, isLoading } = useHub();

  if (isLoading) return { blocked: false, isLoading: true };

  // Only admins can be blocked; client users are never affected
  if (role !== "admin") return { blocked: false, isLoading: false };

  return { blocked: !linearConnected, isLoading: false };
}
