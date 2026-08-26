import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { config } from '#/config/config.js'

/**
 * A real ioredis client with `keyPrefix` set transparently prepends that
 * prefix to every key arg of a hash command (HSET/HGETALL/HDEL/HGET all
 * declare their first arg as the key), so a single-hash design never hits
 * the KEYS-vs-MGET prefixing mismatch the earlier per-user-key design had.
 * This fake only needs to model one Redis hash, keyed as the real client
 * would key it.
 *
 * The store module caches its client in a module-level singleton (by
 * design — one connection per process), so this fake is built once and
 * its backing Map is cleared between tests rather than swapping in a new
 * client object per test — that keeps the store module (and the `config`
 * singleton it reads from) imported exactly once for the whole file,
 * avoiding the module-identity split `vi.resetModules()` would otherwise
 * introduce between this file's `config` reference and the one the store
 * module itself uses.
 */
function makeFakeRedisClient() {
  const hash = new Map()
  return {
    hash,
    hset: vi.fn(async (_key, field, value) => {
      hash.set(field, value)
      return 1
    }),
    hdel: vi.fn(async (_key, ...fields) => {
      let removed = 0
      for (const field of fields) {
        if (hash.delete(field)) {
          removed++
        }
      }
      return removed
    }),
    hget: vi.fn(async (_key, field) => hash.get(field) ?? null),
    hgetall: vi.fn(async () => Object.fromEntries(hash))
  }
}

const fakeClient = makeFakeRedisClient()

vi.mock('#/server/common/helpers/redis-client.js', () => ({
  buildRedisClient: vi.fn(() => fakeClient)
}))

const {
  findAssignableUserInStore,
  listAssignableUsers,
  removeAssignableUser,
  upsertAssignableUser
} = await import('./assignable-users-store.js')

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

describe('assignable-users-store', () => {
  beforeEach(() => {
    fakeClient.hash.clear()
    fakeClient.hset.mockClear()
    fakeClient.hdel.mockClear()
    fakeClient.hget.mockClear()
    fakeClient.hgetall.mockClear()
  })

  test('upsertAssignableUser stores the entry in the assignable-users hash', async () => {
    await upsertAssignableUser({ id: 'oid-1', name: 'Reg One', email: 'r1@d' })

    expect(fakeClient.hset).toHaveBeenCalledWith(
      'assignable-users',
      'oid-1',
      expect.any(String)
    )
    const stored = JSON.parse(fakeClient.hset.mock.calls[0][2])
    expect(stored).toMatchObject({
      id: 'oid-1',
      name: 'Reg One',
      email: 'r1@d',
      roles: ['standard']
    })
    expect(stored.lastLoginAt).toEqual(expect.any(String))
  })

  test('upsertAssignableUser stores the caller-supplied roles when given', async () => {
    await upsertAssignableUser({
      id: 'oid-1',
      name: 'Reg One',
      roles: ['standard', 'role:nation-england']
    })

    const stored = JSON.parse(fakeClient.hset.mock.calls[0][2])
    expect(stored.roles).toEqual(['standard', 'role:nation-england'])
  })

  test('findAssignableUserInStore returns the stored entry after upsert', async () => {
    await upsertAssignableUser({ id: 'oid-1', name: 'Reg One', email: 'r1@d' })

    const found = await findAssignableUserInStore('oid-1')
    expect(found).toMatchObject({ id: 'oid-1', name: 'Reg One' })
  })

  test('findAssignableUserInStore returns null when absent', async () => {
    expect(await findAssignableUserInStore('missing')).toBeNull()
  })

  test('removeAssignableUser deletes the entry', async () => {
    await upsertAssignableUser({ id: 'oid-1', name: 'Reg One' })
    await removeAssignableUser('oid-1')

    expect(await findAssignableUserInStore('oid-1')).toBeNull()
  })

  test('listAssignableUsers returns all stored entries', async () => {
    await upsertAssignableUser({ id: 'oid-1', name: 'Reg One' })
    await upsertAssignableUser({ id: 'oid-2', name: 'Reg Two' })

    const users = await listAssignableUsers()
    expect(users.map((u) => u.id).sort()).toEqual(['oid-1', 'oid-2'])
  })

  test('listAssignableUsers returns an empty array when nothing is stored', async () => {
    expect(await listAssignableUsers()).toEqual([])
  })

  test('listAssignableUsers sorts by name (falling back to id) for a stable render order', async () => {
    await upsertAssignableUser({ id: 'oid-2', name: 'Zoe' })
    await upsertAssignableUser({ id: 'oid-1', name: 'Amy' })
    await upsertAssignableUser({ id: 'oid-3', name: null })

    const users = await listAssignableUsers()
    expect(users.map((u) => u.id)).toEqual(['oid-1', 'oid-3', 'oid-2'])
  })

  describe('inactivity pruning', () => {
    const originalDays = config.get('auth.assignableUserInactivityDays')

    afterEach(() => {
      config.set('auth.assignableUserInactivityDays', originalDays)
    })

    test('listAssignableUsers excludes and prunes an entry past the inactivity threshold', async () => {
      config.set('auth.assignableUserInactivityDays', 90)
      const stale = JSON.stringify({
        id: 'oid-stale',
        name: 'Stale',
        roles: ['standard'],
        lastLoginAt: isoDaysAgo(91)
      })
      fakeClient.hash.set('oid-stale', stale)
      await upsertAssignableUser({ id: 'oid-fresh', name: 'Fresh' })

      const users = await listAssignableUsers()

      expect(users.map((u) => u.id)).toEqual(['oid-fresh'])
      // Pruning is fire-and-forget; give the microtask queue a turn.
      await Promise.resolve()
      expect(fakeClient.hdel).toHaveBeenCalledWith(
        'assignable-users',
        'oid-stale'
      )
    })

    test('findAssignableUserInStore returns null and prunes an expired entry', async () => {
      config.set('auth.assignableUserInactivityDays', 90)
      const stale = JSON.stringify({
        id: 'oid-stale',
        name: 'Stale',
        roles: ['standard'],
        lastLoginAt: isoDaysAgo(91)
      })
      fakeClient.hash.set('oid-stale', stale)

      expect(await findAssignableUserInStore('oid-stale')).toBeNull()
      await Promise.resolve()
      expect(fakeClient.hdel).toHaveBeenCalledWith(
        'assignable-users',
        'oid-stale'
      )
    })

    test('a change to the inactivity threshold applies immediately, not just to entries written afterwards', async () => {
      config.set('auth.assignableUserInactivityDays', 90)
      await upsertAssignableUser({ id: 'oid-1', name: 'Reg One' })
      expect(await findAssignableUserInStore('oid-1')).not.toBeNull()

      // Same stored entry, but the threshold is now stricter than the age
      // implied by "just logged in" would ever trip — simulate that by
      // lowering it to 0 days, which makes any entry with any nonzero age
      // stale. A tiny real delay guarantees a nonzero age without relying
      // on exact-zero-elapsed-ms boundary behaviour.
      await new Promise((resolve) => setTimeout(resolve, 5))
      config.set('auth.assignableUserInactivityDays', 0)
      expect(await findAssignableUserInStore('oid-1')).toBeNull()
    })
  })
})
