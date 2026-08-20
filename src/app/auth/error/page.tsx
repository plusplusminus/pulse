import Link from "next/link";

export default function AuthErrorPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-8 text-center">
        <h1 className="text-lg font-medium text-foreground">
          Sign in failed
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong during sign in. This can happen if the login
          link expired or was already used. Please try again.
        </p>
        <Link
          href="/login"
          className="mt-6 inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Try again
        </Link>
      </div>
    </div>
  );
}
