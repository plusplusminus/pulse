import { withAuth } from '@workos-inc/authkit-nextjs'
import { redirect } from 'next/navigation'

export default async function LoginPage() {
  const { user } = await withAuth()
  if (user) redirect('/')
  redirect('/auth/sign-in')
}
