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
    expect(reAccreditationType.templateVersion).toBe('v11')
    expect(reAccreditationType.initialState.id).toBe('submitted')
  })

  // RA-324. The state DisplayNames mirror the backend's rename byte-for-byte
  // (state ids unchanged). These are the labels the Applications tiles and the
  // detail-page badge render, so guard them explicitly.
  test('declares the RA-324 Applications state labels (mirrors backend)', () => {
    const labels = Object.fromEntries(
      reAccreditationType.states.map((s) => [s.id, s.displayName])
    )
    expect(labels).toMatchObject({
      submitted: 'Not started',
      'duly-made': 'Duly made',
      'assessment-in-progress': 'Updated',
      'awaiting-decision': 'Awaiting decision',
      queried: 'Queried',
      updated: 'Updated',
      approved: 'Granted',
      rejected: 'Refused',
      withdrawn: 'Withdrawn'
    })
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
    // RA-337: a resumed-but-not-yet-reviewed application is likewise not
    // a closed outcome.
    expect(states.updated.isTerminal).toBeFalsy()
  })

  test('declares the queried state so its label resolves (RA-211/RA-291)', () => {
    const queried = reAccreditationType.states.find((s) => s.id === 'queried')

    expect(queried).toBeDefined()
    expect(queried.displayName).toBe('Queried')
  })

  test('declares the updated state so its label resolves (RA-337)', () => {
    const updated = reAccreditationType.states.find((s) => s.id === 'updated')

    expect(updated).toBeDefined()
    expect(updated.displayName).toBe('Updated')
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
    ['withdraw-during-decision', 'awaiting-decision', 'withdrawn', false],
    ['withdraw-during-query', 'queried', 'withdrawn', false],
    ['withdraw-during-updated', 'updated', 'withdrawn', false],
    // RA-291. Caller-invocable: each has a distinct from-state.
    ['query-during-duly-making', 'submitted', 'queried', false],
    ['query-during-duly-made', 'duly-made', 'queried', false],
    ['query-during-assessment', 'assessment-in-progress', 'queried', false],
    ['query-during-decision', 'awaiting-decision', 'queried', false],
    // RA-311/MBE-1. All four share from-state `queried`.
    ['resume-during-duly-making', 'queried', 'updated', false],
    ['resume-during-duly-made', 'queried', 'updated', false],
    ['resume-during-assessment', 'queried', 'updated', false],
    ['resume-during-decision', 'queried', 'updated', false]
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

  // RA-372. The four onward transitions out of `updated`, one per state a
  // query can be raised from. Their existence is what makes `updated` a
  // pass-through rather than the dead end the bug reported.
  test.each([
    ['continue-review-during-duly-making', 'submitted'],
    ['continue-review-during-duly-made', 'duly-made'],
    ['continue-review-during-assessment', 'assessment-in-progress'],
    ['continue-review-during-decision', 'awaiting-decision']
  ])('declares transition %s: updated -> %s', (actionId, toStateId) => {
    const transition = reAccreditationType.transitions.find(
      (t) => t.actionId === actionId
    )
    expect(transition).toMatchObject({
      displayName: 'Continue review',
      fromStateId: 'updated',
      toStateId,
      // Never gated on task completion: `updated` shows the originating
      // state's tasks, and the point of continuing is to get back to that
      // state so the outstanding ones can be finished there.
      requiresAllTasksComplete: false,
      // Resolved server-side from the work item's audit history. All four
      // share `fromStateId: 'updated'`, so a caller-chosen action could
      // send the application to the wrong stage.
      callerInvocable: false
    })
  })

  // RA-372. The backend declares EIGHT non-caller-invocable transitions —
  // the four `continue-review-during-*` above plus the four
  // `resume-during-*` — and this assertion is exhaustive against that
  // list, not just against the ones this ticket added.
  //
  // Getting this wrong is a live security regression, not a cosmetic
  // mismatch: dropping the flag from any of the eight would make the
  // mirror advertise a set of same-from-state transitions as caller-
  // choosable, i.e. as if the user could pick the destination state.
  test('flags exactly the nine server-resolved transitions the backend does', () => {
    const serverResolved = reAccreditationType.transitions
      .filter((t) => t.callerInvocable === false)
      .map((t) => t.actionId)
      .sort()

    expect(serverResolved).toEqual([
      'continue-review-during-assessment',
      'continue-review-during-decision',
      'continue-review-during-duly-made',
      'continue-review-during-duly-making',
      // RA-316. Server-resolved for a different reason from the others:
      // not because the caller could pick the wrong target, but because
      // duly making carries a payment date that the generic
      // `/actions/{actionId}` route has nowhere to put.
      'duly-make',
      'resume-during-assessment',
      'resume-during-decision',
      'resume-during-duly-made',
      'resume-during-duly-making'
    ])
  })

  // ⚠ DO NOT DELETE THE `approve` TRANSITION. It looks like mirror drift
  // — the backend deliberately omits `approve` from
  // `ReAccreditationType.Transitions` so its generic engine refuses
  // `/actions/approve` — and RA-372 removed it on exactly that reasoning
  // before restoring it.
  //
  // It is load-bearing on THIS side: `approve-eligibility.js` (RA-346, now
  // merged) reads this declaration to gate both the Approve CTA and the
  // approve route, and `requiresAllTasksComplete: true` here is the ONLY
  // thing stopping an approval while `record-decision-rationale` is
  // pending. Deleting it, or dropping that flag, silently re-opens the
  // RA-346 bug — and because the deletion merges CLEANLY rather than
  // conflicting, nothing else would flag it. `approve-eligibility.test.js`
  // guards the same declaration from the consumer side; this is the
  // declaration-side guard.
  test('still declares the approve transition RA-346 gating depends on', () => {
    expect(
      reAccreditationType.transitions.find((t) => t.actionId === 'approve')
    ).toMatchObject({
      fromStateId: 'awaiting-decision',
      toStateId: 'approved',
      requiresAllTasksComplete: true
    })
  })

  // The whole mirror, pinned in one place. RA-372 found it three blocks
  // short; this is what stops that recurring silently.
  //
  // One KNOWN divergence from the backend, deliberately kept and now
  // documented at the declaration itself: `approve` is declared here but
  // not there, because it is frontend-only (see the guard test above).
  // Everything else is one-for-one with `ReAccreditationType.Transitions`.
  test('pins the full declared transition set (backend set, plus approve)', () => {
    expect(
      reAccreditationType.transitions.map((t) => t.actionId).sort()
    ).toEqual([
      'approve',
      'continue-review-during-assessment',
      'continue-review-during-decision',
      'continue-review-during-duly-made',
      'continue-review-during-duly-making',
      'duly-make',
      'payment-received',
      'query-during-assessment',
      'query-during-decision',
      'query-during-duly-made',
      'query-during-duly-making',
      'reject',
      'resume-during-assessment',
      'resume-during-decision',
      'resume-during-duly-made',
      'resume-during-duly-making',
      'sla-extend',
      'submit-for-decision',
      'withdraw',
      'withdraw-during-assessment',
      'withdraw-during-decision',
      'withdraw-during-duly-made',
      'withdraw-during-query',
      'withdraw-during-updated'
    ])
  })

  test.each([
    // RA-316. `submitted` owns NO tasks. Both of its former tasks, and the
    // backend hook that auto-transitioned to `duly-made` once they were
    // ticked, were deleted when the Duly make CTA + payment-date page
    // replaced that mechanism. Re-adding them here would not restore the
    // old behaviour — the auto-transition is gone — it would only show a
    // regulator a checklist that does nothing.
    ['submitted', []],
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

  // RA-372. Guards against a well-meaning "fix" that adds an `updated`
  // entry to TASKS_BY_STATE. The tasks shown while an item is in `updated`
  // are the ORIGINATING state's, resolved per work item by the backend
  // from its audit history and carrying that state's existing completion
  // status — a property of the item, not of the state. The UI reads them
  // off `workItem.tasks` in the API response; a static list here would be
  // wrong for every item whose query came from a different state.
  test('getTasksForState(updated) is empty — the backend projects them per item', () => {
    expect(reAccreditationType.getTasksForState('updated')).toEqual([])
  })

  test('getTasksForState(queried) is empty', () => {
    expect(reAccreditationType.getTasksForState('queried')).toEqual([])
  })

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
      // Approval (RA-132), continue-review (RA-372) and duly-making
      // (RA-316) routes are always mounted; create routes (RA-127) are
      // only mounted when the flag is on.
      expect(server.route).toHaveBeenCalledTimes(4)
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
      // Only the always-on approval (RA-132), continue-review (RA-372) and
      // duly-making (RA-316) routes are mounted.
      expect(server.route).toHaveBeenCalledTimes(3)
      expect(
        server.route.mock.calls.every(([routes]) =>
          routes.every((r) => r.path !== '/work-items/re-accreditation/new')
        )
      ).toBe(true)
    })

    // RA-372.
    test('always mounts the continue-review route regardless of the create flag', async () => {
      for (const flag of [true, false]) {
        config.set(flagKey, flag)
        const server = { route: vi.fn() }
        await reAccreditationModule.register(server)
        const continueReviewCall = server.route.mock.calls.find(([routes]) =>
          routes.some(
            (r) =>
              r.path === '/work-items/re-accreditation/{id}/continue-review'
          )
        )
        expect(continueReviewCall).toBeDefined()
        expect(
          continueReviewCall[0].map((r) => `${r.method} ${r.path}`)
        ).toEqual(['POST /work-items/re-accreditation/{id}/continue-review'])
      }
    })
  })
})
