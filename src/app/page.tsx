import { signOut, withAuth } from '@workos-inc/authkit-nextjs'
import { redirect } from 'next/navigation'
import { isPPMAdmin } from '@/lib/ppm-admin'
import { getHubForUser } from '@/lib/hub-auth'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import Image from 'next/image'

export default async function Home() {
  const { user } = await withAuth()

  if (user) {
    // PPM admins go to the admin portal
    if (await isPPMAdmin(user.id, user.email)) {
      redirect('/admin')
    }

    // Clients go to their hub
    const hubSlug = await getHubForUser(user.id, user.email)
    if (hubSlug) {
      redirect(`/hub/${hubSlug}`)
    }

    // Authenticated but no role — show no-access message
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex w-full max-w-sm flex-col items-center gap-6 px-4 text-center">
          <Image src="/pulse-logo.png" alt="Pulse" width={48} height={48} />
          <div>
            <h1 className="text-lg font-semibold text-foreground">
              No access
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              You don&apos;t have access to any portals. Contact your administrator if you believe this is an error.
            </p>
          </div>
          <form action={async () => {
            'use server'
            await signOut()
          }}>
            <Button variant="outline" type="submit" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex w-full max-w-sm flex-col items-center gap-6 px-4">
        <div className="flex flex-col items-center gap-2">
          <Image src="/pulse-logo.png" alt="Pulse" width={48} height={48} />
          <h1 className="text-lg font-semibold text-foreground">
            Pulse
          </h1>
          <p className="text-sm text-muted-foreground">
            Sign in to continue
          </p>
        </div>
        <Button asChild className="w-full">
          <Link href="/auth/sign-in">Sign in</Link>
        </Button>
      </div>
    </div>
  )
}
