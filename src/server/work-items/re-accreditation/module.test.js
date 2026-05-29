import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'

import { config } from '#/config/config.js'
import { reAccreditationModule, reAccreditationType } from './module.js'
import { assertValidWorkItemModule } from '../core/module.js'

describe('reAccreditationModule', () => {
  test('passes the framework module shape contract', () => {
    expect(() => assertValidWorkItemModule(reAccreditationModule)).not.toThrow()
  })

  test('declares the expected stable identity and detail template', () => {
    expect(reAccreditationType.id).toBe('re-accreditation')
    expect(reAccreditationType.displayName).toBe('Re-accreditation')
    expect(reAccreditationType.detailTemplate).toBe(
      're-accreditation/detail-v1'
    )
    expect(reAccreditationType.initialState.id).toBe('submitted')
  })

  test('marks approved / rejected / withdrawn as terminal and others as not', () => {
    const states = Object.fromEntries(
      reAccreditationType.states.map((s) => [s.id, s])
    )
    expect(states.approved.isTerminal).toBe(true)
    expect(states.rejected.isTerminal).toBe(true)
    expect(states.withdrawn.isTerminal).toBe(true)
    expect(states.submitted.isTerminal).toBeFalsy()
    expect(states['assessment-in-progress'].isTerminal).toBeFalsy()
    expect(states['awaiting-decision'].isTerminal).toBeFalsy()
  })

  test.each([
    ['duly-make', 'submitted', 'duly-made', true],
    ['payment-received', 'duly-made', 'assessment-in-progress', true],
    ['sla-extend', 'assessment-in-progress', 'assessment-in-progress', false],
    [
      'submit-for-decision',
      'assessment-in-progress',
      'awaiting-decision',
      true
    ],
    ['approve', 'awaiting-decision', 'approved', true],
    ['reject', 'awaiting-decision', 'rejected', true],
    ['withdraw', 'submitted', 'withdrawn', false],
    ['withdraw-during-duly-made', 'duly-made', 'withdrawn', false],
    [
      'withdraw-during-assessment',
      'assessment-in-progress',
      'withdrawn',
      false
    ],
    ['withdraw-during-decision', 'awaiting-decision', 'withdrawn', false]
  ])(
    'declares transition %s: %s -> %s (requires=%s)',
    (actionId, fromStateId, toStateId, requires) => {
      const transition = reAccreditationType.transitions.find(
        (t) => t.actionId === actionId
      )
      expect(transition).toMatchObject({
        fromStateId,
        toStateId,
        requiresAllTasksComplete: requires
      })
    }
  )

  test.each([
    [
      'submitted',
      ['verify-organisation-details', 'confirm-application-completeness']
    ],
    ['duly-made', ['confirm-registration-fee-paid']],
    [
      'assessment-in-progress',
      [
        'review-compliance-history',
        'assess-technical-capacity',
        'assess-financial-capacity'
      ]
    ],
    ['awaiting-decision', ['record-decision-rationale']]
  ])('getTasksForState(%s) returns the expected ids', (stateId, expected) => {
    expect(
      reAccreditationType.getTasksForState(stateId).map((t) => t.id)
    ).toEqual(expected)
  })

  test.each(['approved', 'rejected', 'withdrawn', 'unknown'])(
    'getTasksForState(%s) is empty',
    (stateId) => {
      expect(reAccreditationType.getTasksForState(stateId)).toEqual([])
    }
  )

  test('register does not throw when called with a stub server', async () => {
    const server = { route: vi.fn() }
    await expect(
      reAccreditationModule.register(server)
    ).resolves.toBeUndefined()
  })

  describe('RA-127 create-work-item routes (feature-flagged)', () => {
    const flagKey = 'featureFlags.workItemCreationEnabled'
    let originalFlag

    beforeEach(() => {
      originalFlag = config.get(flagKey)
    })

    afterEach(() => {
      config.set(flagKey, originalFlag)
    })

    test('mounts the GET + POST create routes when the flag is on', async () => {
      config.set(flagKey, true)
      const server = { route: vi.fn() }
      await reAccreditationModule.register(server)
      // Approval routes (RA-132) are always mounted; create routes
      // (RA-127) are only mounted when the flag is on.
      expect(server.route).toHaveBeenCalledTimes(2)
      const createCall = server.route.mock.calls.find(([routes]) =>
        routes.some((r) => r.path === '/work-items/re-accreditation/new')
      )
      expect(createCall).toBeDefined()
      const methods = createCall[0].map((r) => `${r.method} ${r.path}`)
      expect(methods).toContain('GET /work-items/re-accreditation/new')
      expect(methods).toContain('POST /work-items/re-accreditation/new')
    })

    test('always mounts the RA-132 approve-determination routes regardless of the create flag', async () => {
      for (const flag of [true, false]) {
        config.set(flagKey, flag)
        const server = { route: vi.fn() }
        await reAccreditationModule.register(server)
        const approvalCall = server.route.mock.calls.find(([routes]) =>
          routes.some(
            (r) => r.path === '/work-items/re-accreditation/{id}/approve'
          )
        )
        expect(approvalCall).toBeDefined()
        const methods = approvalCall[0].map((r) => `${r.method} ${r.path}`)
        expect(methods).toContain(
          'GET /work-items/re-accreditation/{id}/approve'
        )
        expect(methods).toContain(
          'POST /work-items/re-accreditation/{id}/approve'
        )
      }
    })

    test('does not mount the create routes when the flag is off', async () => {
      config.set(flagKey, false)
      const server = { route: vi.fn() }
      await reAccreditationModule.register(server)
      // Only the always-on approval routes (RA-132) are mounted.
      expect(server.route).toHaveBeenCalledTimes(1)
      const [routes] = server.route.mock.calls[0]
      expect(
        routes.every((r) => r.path !== '/work-items/re-accreditation/new')
      ).toBe(true)
    })
  })
})
