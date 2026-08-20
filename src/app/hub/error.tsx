"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function HubError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error, { tags: { area: "hub" } });
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="text-center">
        <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100">
          Something went wrong
        </h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          An error occurred loading this page.
        </p>
        <button
          onClick={reset}
          className="mt-4 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
