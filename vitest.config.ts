import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import path from "path";

export default defineConfig(({ mode }) => {
  // Load .env.local for integration tests (real Supabase credentials)
  const env = loadEnv(mode, process.cwd(), "");

  return {
    // tsconfig uses "jsx": "preserve" (Next.js transforms JSX itself), so
    // tell esbuild to use the automatic runtime for .tsx test files.
    esbuild: { jsx: "automatic" },
    test: {
      globals: true,
      environment: "node",
      env: {
        NEXT_PUBLIC_SUPABASE_URL:
          env.NEXT_PUBLIC_SUPABASE_URL || "http://localhost:54321",
        NEXT_PUBLIC_SUPABASE_ANON_KEY:
          env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "test-anon-key",
        SUPABASE_SERVICE_ROLE_KEY:
          env.SUPABASE_SERVICE_ROLE_KEY || "test-service-key",
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
