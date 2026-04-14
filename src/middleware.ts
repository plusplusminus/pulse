import { authkit, handleAuthkitHeaders } from '@workos-inc/authkit-nextjs'
import { NextResponse, type NextRequest } from 'next/server'
import { lookupHubBySlug, lookupPPMAdmin } from '@/lib/edge-db'

export default async function middleware(request: NextRequest) {
  const { session, headers, authorizationUrl } = await authkit(request)
  const { pathname } = request.nextUrl

  // Enforce auth on protected PPM routes
  const protectedPaths = ['/profile', '/docs']
  const isProtected = protectedPaths.some(p => pathname === p || pathname.startsWith(p + '/'))

  if (isProtected && !session.user && authorizationUrl) {
    return handleAuthkitHeaders(request, headers, { redirect: authorizationUrl })
  }

  // Admin routes: require auth + PPM admin
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    if (!session.user && authorizationUrl) {
      return handleAuthkitHeaders(request, headers, { redirect: authorizationUrl })
    }
    if (session.user) {
      const isAdmin = await lookupPPMAdmin(session.user.id, session.user.email)
      if (!isAdmin) {
        return new NextResponse('Forbidden', { status: 403 })
      }
    }
    return handleAuthkitHeaders(request, headers)
  }

  // Hub routes: redirect unauthenticated users to hub-specific login
  const hubMatch = pathname.match(/^\/hub\/([^/]+)/)
  if (hubMatch) {
    const slug = hubMatch[1]
    const isLoginPage = pathname === `/hub/${slug}/login`

    // Login page is always accessible
    if (!isLoginPage && !session.user) {
      const loginUrl = new URL(`/hub/${slug}/login`, request.url)
      return handleAuthkitHeaders(request, headers, { redirect: loginUrl.toString() })
    }

    // If authenticated, verify org match or PPM admin status
    if (!isLoginPage && session.user) {
      // PPM admins can access any hub
      const isAdmin = await lookupPPMAdmin(session.user.id, session.user.email)
      if (isAdmin) {
        return handleAuthkitHeaders(request, headers)
      }

      const hub = await lookupHubBySlug(slug)

      if (session.organizationId) {
        // Client user — verify org matches hub
        if (hub && hub.workos_org_id && session.organizationId !== hub.workos_org_id) {
          const loginUrl = new URL(`/hub/${slug}/login`, request.url)
          return handleAuthkitHeaders(request, headers, { redirect: loginUrl.toString() })
        }
      } else {
        // Authenticated but no org — redirect to the hub login page so the
        // user can sign in through the org-specific flow. This commonly
        // happens when a user completed email/code auth without a prior org
        // invitation acceptance (e.g. the callback was broken).
        const loginUrl = new URL(`/hub/${slug}/login`, request.url)
        return handleAuthkitHeaders(request, headers, { redirect: loginUrl.toString() })
      }
    }

    return handleAuthkitHeaders(request, headers)
  }

  return handleAuthkitHeaders(request, headers)
}

export const config = {
  matcher: [
    '/((?!monitoring|_next/static|_next/image|favicon.ico|.*\\..*).*)',
  ],
}
