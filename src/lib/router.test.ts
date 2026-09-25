import { describe, expect, it } from 'vitest'
import { parseRoute, pathFor, type Route } from './router'

const id = '0b7c4c5e-1111-4222-8333-444455556666'
const code = '9f0c2a7d1b3e4f5a6b7c8d9e0f1a2b3c'

describe('parseRoute', () => {
  it('reads each page', () => {
    expect(parseRoute('/')).toEqual({ name: 'home' })
    expect(parseRoute(`/c/${id}`)).toEqual({ name: 'chat', id })
    expect(parseRoute('/friends')).toEqual({ name: 'friends' })
    expect(parseRoute('/profile')).toEqual({ name: 'profile' })
    expect(parseRoute('/share')).toEqual({ name: 'share' })
    expect(parseRoute('/login')).toEqual({ name: 'login' })
    expect(parseRoute('/privacy')).toEqual({ name: 'privacy' })
    expect(parseRoute(`/join/${code}`)).toEqual({ name: 'join', code })
    expect(parseRoute('/add/Ameera_1')).toEqual({ name: 'add', username: 'ameera_1' })
  })

  it('lower-cases ids and codes', () => {
    expect(parseRoute(`/c/${id.toUpperCase()}`)).toEqual({ name: 'chat', id })
  })

  it('sends anything it does not recognise home', () => {
    expect(parseRoute('/c/not-a-uuid')).toEqual({ name: 'home' })
    expect(parseRoute('/join/short')).toEqual({ name: 'home' })
    expect(parseRoute('/add/no')).toEqual({ name: 'home' })
    expect(parseRoute('/add/not-a-username')).toEqual({ name: 'home' })
    expect(parseRoute('/nowhere')).toEqual({ name: 'home' })
  })
})

describe('pathFor', () => {
  it('round-trips with parseRoute', () => {
    const routes: Route[] = [
      { name: 'home' },
      { name: 'chat', id },
      { name: 'friends' },
      { name: 'profile' },
      { name: 'share' },
      { name: 'login' },
      { name: 'privacy' },
      { name: 'join', code },
      { name: 'add', username: 'ameera_1' },
    ]
    for (const route of routes) expect(parseRoute(pathFor(route))).toEqual(route)
  })
})
