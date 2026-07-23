'use server'

// ─── Settings server actions ────────────────────────────────────────────────
// Server-side mutations for the settings page. Using server actions instead
// of client-side supabase.from(...).update(...) so we can:
//   1. Read user identity from the server's supabase session (which holds
//      the correct SSR cookie format), not the browser's localStorage
//      (which can be stale or empty depending on the auth flow the user
//      used to sign up).
//   2. Bypass the 'not signed in' failure mode that happens when the
//      client supabase client's getUser() returns null because the
//      auth-storage key was never populated.
//
// All actions return { ok, error? } for type-safe client handling.

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { isIdentity, type Identity } from '@/lib/identity'

type Result = { ok: true } | { ok: false; error: string }

export async function updateIdentity(newIdentity: Identity): Promise<Result> {
  if (!isIdentity(newIdentity)) {
    return { ok: false, error: 'invalid identity value' }
  }
  try {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll() },
          setAll(cookiesToSet) {
            // Server actions CAN set cookies (unlike root layout RSC).
            try {
              for (const { name, value, options } of cookiesToSet) {
                cookieStore.set(name, value, options)
              }
            } catch {
              // In Server Components (no request scope) set is not allowed;
              // ignore since the cookie is already set by middleware.
            }
          },
        },
      },
    )
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: 'not signed in' }

    const { error } = await supabase
      .from('profiles')
      .update({ identity: newIdentity })
      .eq('id', user.id)
    if (error) return { ok: false, error: error.message }

    // Revalidate so the next render reads the new identity.
    revalidatePath('/', 'layout')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
