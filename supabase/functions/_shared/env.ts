/** A required secret or setting: stops the function with a clear message if it's missing. */
export function requireEnv(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing ${name}: add it in Supabase → Edge Functions → Secrets.`)
  return value
}
