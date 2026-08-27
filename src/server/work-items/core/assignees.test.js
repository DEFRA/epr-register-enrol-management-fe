import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { config } from '#/config/config.js'
import { STUB_USERS } from '#/server/routes/auth/stub/controller.js'

const storeMocks = vi.hoisted(() => ({
  listAssignableUsers: vi.fn(),
  findAssignableUserInStore: vi.fn()
}))

vi.mock('#/server/common/helpers/auth/assignable-users-store.js', () => ({
  listAssignableUsers: storeMocks.listAssignableUsers,
  findAssignableUserInStore: storeMocks.findAssignableUserInStore
}))

const { findAssignableUser, getAssignableUsers } =
  await import('#/server/work-items/core/assignees.js')

describe('work-items/core/assignees', () => {
  const originalStubEnabled = config.get('auth.stubEnabled')

  afterEach(() => {
    config.set('auth.stubEnabled', originalStubEnabled)
    storeMocks.listAssignableUsers.mockReset()
    storeMocks.findAssignableUserInStore.mockReset()
  })

  describe('when stub auth is enabled', () => {
    beforeEach(() => {
      config.set('auth.stubEnabled', true)
    })

    it('returns the stub user directory', async () => {
      const users = await getAssignableUsers()
      expect(users).toHaveLength(STUB_USERS.length)
      expect(users.map((u) => u.id)).toEqual(STUB_USERS.map((u) => u.id))
    })

    it('returns a fresh array each call (no shared reference)', async () => {
      const a = await getAssignableUsers()
      const b = await getAssignableUsers()
      expect(a).not.toBe(b)
      a.length = 0
      expect(await getAssignableUsers()).toHaveLength(STUB_USERS.length)
    })

    it('does not return the live STUB_USERS array', async () => {
      expect(await getAssignableUsers()).not.toBe(STUB_USERS)
    })

    it('freezes per-user entries so property writes throw in strict mode', async () => {
      const [first] = await getAssignableUsers()
      expect(Object.isFrozen(first)).toBe(true)
      expect(() => {
        first.name = 'tampered'
      }).toThrow(TypeError)
      expect(Object.isFrozen(first.roles)).toBe(true)
    })

    it('findAssignableUser returns the matching frozen entry', async () => {
      const [first] = STUB_USERS
      const found = await findAssignableUser(first.id)
      expect(found).not.toBeNull()
      expect(found.id).toBe(first.id)
      expect(Object.isFrozen(found)).toBe(true)
    })

    it('findAssignableUser returns null for unknown ids', async () => {
      expect(await findAssignableUser('does-not-exist')).toBeNull()
    })

    it('findAssignableUser returns null for invalid input', async () => {
      expect(await findAssignableUser(null)).toBeNull()
      expect(await findAssignableUser(undefined)).toBeNull()
      expect(await findAssignableUser('')).toBeNull()
      expect(await findAssignableUser('   ')).toBeNull()
      expect(await findAssignableUser(42)).toBeNull()
    })

    it('never touches the real-directory store while stub auth is enabled', async () => {
      await getAssignableUsers()
      await findAssignableUser(STUB_USERS[0].id)
      expect(storeMocks.listAssignableUsers).not.toHaveBeenCalled()
      expect(storeMocks.findAssignableUserInStore).not.toHaveBeenCalled()
    })
  })

  // RA-446: real (non-stub) deployments read the Entra-ID-populated store.
  describe('when stub auth is disabled (production-mode)', () => {
    beforeEach(() => {
      config.set('auth.stubEnabled', false)
    })

    it('getAssignableUsers reads from the assignable-users store', async () => {
      const stored = [{ id: 'oid-1', name: 'Reg One', email: 'r1@d' }]
      storeMocks.listAssignableUsers.mockResolvedValue(stored)

      expect(await getAssignableUsers()).toBe(stored)
    })

    it('findAssignableUser reads a single entry from the store', async () => {
      const entry = { id: 'oid-1', name: 'Reg One' }
      storeMocks.findAssignableUserInStore.mockResolvedValue(entry)

      expect(await findAssignableUser('oid-1')).toBe(entry)
      expect(storeMocks.findAssignableUserInStore).toHaveBeenCalledWith('oid-1')
    })

    it('findAssignableUser returns null for invalid input without hitting the store', async () => {
      expect(await findAssignableUser('')).toBeNull()
      expect(await findAssignableUser(null)).toBeNull()
      expect(storeMocks.findAssignableUserInStore).not.toHaveBeenCalled()
    })

    it('never falls back to the stub directory', async () => {
      storeMocks.listAssignableUsers.mockResolvedValue([])
      const users = await getAssignableUsers()
      expect(users.map((u) => u.id)).not.toContain(STUB_USERS[0].id)
    })

    // RA-446: before this change, getAssignableUsers/findAssignableUser
    // were pure in-memory functions that could never fail. A Redis outage
    // must degrade to "no assignable users" rather than 500ing the
    // work-items list or the assign write path.
    it('getAssignableUsers returns an empty array when the store read fails', async () => {
      storeMocks.listAssignableUsers.mockRejectedValue(
        new Error('redis unavailable')
      )
      expect(await getAssignableUsers()).toEqual([])
    })

    it('findAssignableUser returns null when the store lookup fails', async () => {
      storeMocks.findAssignableUserInStore.mockRejectedValue(
        new Error('redis unavailable')
      )
      expect(await findAssignableUser('oid-1')).toBeNull()
    })
  })
})
