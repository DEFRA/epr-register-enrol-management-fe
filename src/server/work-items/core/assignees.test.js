import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { config } from '#/config/config.js'
import {
  findAssignableUser,
  getAssignableUsers
} from '#/server/work-items/core/assignees.js'
import { STUB_USERS } from '#/server/routes/auth/stub/controller.js'

describe('work-items/core/assignees', () => {
  const originalStubEnabled = config.get('auth.stubEnabled')

  afterEach(() => {
    config.set('auth.stubEnabled', originalStubEnabled)
  })

  describe('when stub auth is enabled', () => {
    beforeEach(() => {
      config.set('auth.stubEnabled', true)
    })

    it('returns the stub user directory', () => {
      const users = getAssignableUsers()
      expect(users).toHaveLength(STUB_USERS.length)
      expect(users.map((u) => u.id)).toEqual(STUB_USERS.map((u) => u.id))
    })

    it('returns a fresh array each call (no shared reference)', () => {
      const a = getAssignableUsers()
      const b = getAssignableUsers()
      expect(a).not.toBe(b)
      a.length = 0
      expect(getAssignableUsers()).toHaveLength(STUB_USERS.length)
    })

    it('does not return the live STUB_USERS array', () => {
      expect(getAssignableUsers()).not.toBe(STUB_USERS)
    })

    it('freezes per-user entries so property writes throw in strict mode', () => {
      const [first] = getAssignableUsers()
      expect(Object.isFrozen(first)).toBe(true)
      expect(() => {
        first.name = 'tampered'
      }).toThrow(TypeError)
      expect(Object.isFrozen(first.roles)).toBe(true)
    })

    it('findAssignableUser returns the matching frozen entry', () => {
      const [first] = STUB_USERS
      const found = findAssignableUser(first.id)
      expect(found).not.toBeNull()
      expect(found.id).toBe(first.id)
      expect(Object.isFrozen(found)).toBe(true)
    })

    it('findAssignableUser returns null for unknown ids', () => {
      expect(findAssignableUser('does-not-exist')).toBeNull()
    })

    it('findAssignableUser returns null for invalid input', () => {
      expect(findAssignableUser(null)).toBeNull()
      expect(findAssignableUser(undefined)).toBeNull()
      expect(findAssignableUser('')).toBeNull()
      expect(findAssignableUser('   ')).toBeNull()
      expect(findAssignableUser(42)).toBeNull()
    })
  })

  describe('when stub auth is disabled (production-mode)', () => {
    beforeEach(() => {
      config.set('auth.stubEnabled', false)
    })

    it('getAssignableUsers returns an empty array', () => {
      expect(getAssignableUsers()).toEqual([])
    })

    it('findAssignableUser returns null even for known stub user ids', () => {
      const [first] = STUB_USERS
      expect(findAssignableUser(first.id)).toBeNull()
    })
  })
})
