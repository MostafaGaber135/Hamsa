import type { Database as Generated } from './database.generated'

export type { Json } from './database.generated'

/**
 * The generated database types, with the few function arguments that may be null.
 * Postgres doesn't record whether a function argument accepts null, so the generator
 * types them all as required; these functions do accept it:
 * - react(emoji => null) takes your reaction back
 * - report(msg_id => null) reports a person rather than a message; details are optional
 * - update_group(new_avatar_url => null) removes the group photo
 */
type Functions = Generated['public']['Functions']

type NullableArgs = {
  react: { Args: Omit<Functions['react']['Args'], 'emoji'> & { emoji: string | null } }
  report: { Args: Omit<Functions['report']['Args'], 'msg_id' | 'details'> & { msg_id: string | null; details?: string | null } }
  update_group: { Args: Omit<Functions['update_group']['Args'], 'new_avatar_url'> & { new_avatar_url: string | null } }
}

export type Database = Omit<Generated, 'public'> & {
  public: Omit<Generated['public'], 'Functions'> & {
    Functions: Omit<Functions, keyof NullableArgs> & {
      [Name in keyof NullableArgs]: Omit<Functions[Name], 'Args'> & NullableArgs[Name]
    }
  }
}
