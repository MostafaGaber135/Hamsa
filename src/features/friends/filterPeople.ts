import type { User } from '@/types/chat'

/**
 * Your own people (friends, members) matching what you typed, by name or username,
 * in alphabetical order. Nothing typed: all of them.
 */
export function filterPeople(people: User[], query: string): User[] {
  const q = query.trim().replace(/^@/, '').toLocaleLowerCase()
  return people
    .filter((p) => !q || p.name.toLocaleLowerCase().includes(q) || p.username?.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name))
}
