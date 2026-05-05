import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Lazy singletons — clients are created on first access, not at module load.
// This prevents "supabaseUrl is required" errors during Next.js build-time
// page-data collection when env vars aren't available.

function makeLazy(factory: () => SupabaseClient): SupabaseClient {
  let instance: SupabaseClient | undefined
  return new Proxy({} as SupabaseClient, {
    get(_, prop) {
      if (!instance) instance = factory()
      const value = (instance as unknown as Record<string | symbol, unknown>)[prop]
      return typeof value === 'function' ? (value as Function).bind(instance) : value
    },
  })
}

export const supabase = makeLazy(() =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
)

export const supabaseAdmin = makeLazy(() =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
)
