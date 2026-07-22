import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import hapi from '@hapi/hapi'

import { config } from '#/config/config.js'
import { reAccreditationModule, reAccreditationType } from './module.js'
import { assertValidWorkItemModule } from '../core/module.js'
import {
  clearDetailTemplateRegistry,
  resolveDetailTemplate
} from '../core/templates.js'

describe('reAccreditationModule', () => {
  beforeEach(() => {
    clearDetailTemplateRegistry()
  })

  test('passes the framework module shape contract', () => {
    expect(() => assertValidWorkItemModule(reAccreditationModule)).not.toThrow()
  })

  test('declares the expected stable identity and template version', () => {
    expect(reAccreditationType.id).toBe('re-accreditation')
    expect(reAccreditationType.displayName).toBe('Re-accreditation')
    expect(reAccreditationType.templateVersion).toBe('v6')
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
    // RA-291: a queried application is paused awaiting the operator's
    // resubmission, so it must stay non-terminal.
    expect(states.queried.isTerminal).toBeFalsy()
  })

  test('declares the queried state so its label resolves (RA-211/RA-291)', () => {
    const queried = reAccreditationType.states.find((s) => s.id === 'queried')

    expect(queried).toBeDefined()
    expect(queried.displayName).toBe('Queried')
  })

  test('every state declares a non-empty display name', () => {
    // Guards the class of bug RA-291 hit: a state present in the backend
    // but missing here renders as its raw lowercase id.
    for (const state of reAccreditationType.states) {
      expect(state.displayName).toEqual(expect.any(String))
      expect(state.displayName.trim()).not.toBe('')
      expect(state.displayName).not.toBe(state.id)
    }
  })

  test.each([
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

  test('register registers a detail template for every version up to the declared current one', async () => {
    // Resolve falls back to the generic detail before register runs.
    expect(
      resolveDetailTemplate(
        're-accreditation',
        reAccreditationType.templateVersion
      )
    ).toBe('work-items/detail')

    const server = hapi.server()
    // The bare hapi server has no auth strategy, so wire up a permissive
    // stub for the auth-scoped routes (approval + create) and disable
    // the RA-127 create routes for this test — we only care that the
    // detail template gets registered.
    server.auth.scheme('stub', () => ({
      authenticate: (_request, h) => h.authenticated({ credentials: {} })
    }))
    server.auth.strategy('session', 'stub')
    server.auth.default('session')
    const flagKey = 'featureFlags.workItemCreationEnabled'
    const previous = config.get(flagKey)
    config.set(flagKey, false)
    try {
      await reAccreditationModule.register(server)
    } finally {
      config.set(flagKey, previous)
    }

    // The guard that would have caught RA-291's regression: the version
    // this type currently declares — which mirrors the backend's
    // `ReAccreditationType.TemplateVersion` and is what gets stamped onto
    // every new work item — MUST have a registered type-specific
    // template. An unregistered version silently falls back to the
    // generic detail view, losing the approve CTA and actions panel with
    // no error raised anywhere.
    const current = reAccreditationType.templateVersion
    expect(resolveDetailTemplate('re-accreditation', current)).toBe(
      're-accreditation/detail-v1'
    )

    // And no gaps below it: every historical version must still resolve
    // so items assessed under an older template keep rendering as they
    // were assessed.
    const currentNumber = Number(current.replace(/^v/, ''))
    expect(currentNumber).toBeGreaterThanOrEqual(1)
    for (let n = 1; n <= currentNumber; n++) {
      expect(resolveDetailTemplate('re-accreditation', `v${n}`)).toBe(
        're-accreditation/detail-v1'
      )
    }
  })

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
