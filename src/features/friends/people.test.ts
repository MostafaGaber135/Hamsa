import { describe, expect, it } from 'vitest'
import type { User } from '@/types/chat'
import { toHandle } from './api'
import { filterPeople } from './filterPeople'

const person = (name: string, username: string): User => ({ id: username, name, username, online: false })
const friends = [person('Omar', 'omar_k'), person('Ameera', 'ameera'), person('منى', 'mona')]

describe('filterPeople', () => {
  it('lists everyone, alphabetically, when nothing is typed', () => {
    expect(filterPeople(friends, '  ').map((p) => p.username)).toEqual(['ameera', 'omar_k', 'mona'])
  })

  it('matches a name or a username, ignoring case and a leading @', () => {
    expect(filterPeople(friends, 'AMEE').map((p) => p.username)).toEqual(['ameera'])
    expect(filterPeople(friends, '@omar').map((p) => p.username)).toEqual(['omar_k'])
    expect(filterPeople(friends, 'منى').map((p) => p.username)).toEqual(['mona'])
  })

  it('finds nobody for a stranger', () => {
    expect(filterPeople(friends, 'zed')).toEqual([])
  })
})

describe('toHandle', () => {
  it('turns what was typed into a username to look for', () => {
    expect(toHandle('  @Ameera ')).toBe('ameera')
    expect(toHandle('omar')).toBe('omar')
  })
})
