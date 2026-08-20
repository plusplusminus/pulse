"use client";

import Link from "next/link";
import { SimpleThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";
import { ArrowLeft } from "lucide-react";

interface AdminTopBarProps {
  user: { id: string; email: string; firstName: string | null };
}

export function AdminTopBar({ user }: AdminTopBarProps) {
  return (
    <header className="flex items-center justify-between h-12 px-4 border-b border-border bg-background shrink-0">
      <div className="flex items-center gap-3">
        <Link
          href="/"
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to app
        </Link>
        <span className="text-border">/</span>
        <span className="text-xs font-medium text-foreground">Admin</span>
      </div>

      <div className="flex items-center gap-3">
        <SimpleThemeToggle />
        <UserMenu displayName={user.firstName ?? user.email} />
      </div>
    </header>
  );
}
