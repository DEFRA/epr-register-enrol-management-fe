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
    expect(reAccreditationType.templateVersion).toBe('v12')
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
    ['payment-received', 'duly-made', 'assessment-in-progress'],
    ['sla-extend', 'assessment-in-progress', 'assessment-in-progress'],
    ['submit-for-decision', 'assessment-in-progress', 'awaiting-decision'],
    ['approve', 'awaiting-decision', 'approved'],
    ['reject', 'awaiting-decision', 'rejected'],
    ['withdraw', 'submitted', 'withdrawn'],
    ['withdraw-during-duly-made', 'duly-made', 'withdrawn'],
    [
      'withdraw-during-assessment',
      'assessment-in-progress',
      'withdrawn',
      false
    ],
    ['withdraw-during-decision', 'awaiting-decision', 'withdrawn'],
    ['withdraw-during-query', 'queried', 'withdrawn'],
    ['withdraw-during-updated', 'updated', 'withdrawn'],
    // RA-291. Caller-invocable: each has a distinct from-state.
    ['query-during-duly-making', 'submitted', 'queried'],
    ['query-during-duly-made', 'duly-made', 'queried'],
    ['query-during-assessment', 'assessment-in-progress', 'queried'],
    ['query-during-decision', 'awaiting-decision', 'queried'],
    // RA-311/MBE-1. All four share from-state `queried`.
    ['resume-during-duly-making', 'queried', 'updated'],
    ['resume-during-duly-made', 'queried', 'updated'],
    ['resume-during-assessment', 'queried', 'updated'],
    ['resume-during-decision', 'queried', 'updated', false]
  ])('declares transition %s: %s -> %s', (actionId, fromStateId, toStateId) => {
    const transition = reAccreditationType.transitions.find(
      (t) => t.actionId === actionId
    )
    expect(transition).toMatchObject({ fromStateId, toStateId })
    // RA-410. `requiresAllTasksComplete` is gone from every entry —
    // management-be deleted the property from `WorkItemTransition`, so a
    // lingering one here would be mirror drift.
    expect(transition).not.toHaveProperty('requiresAllTasksComplete')
  })

  // RA-351. The FE mirror holds exactly ONE `sla-extend` transition, on
  // `assessment-in-progress`. The backend's transition set adds a second
  // `sla-extend` self-loop on `queried` (so a queried item projects it into
  // `availableActions`), but the FE framework keys transition `actionId`
  // uniqueness globally — `assertValidWorkItemModule` throws on a duplicate —
  // so that second entry is deliberately NOT mirrored here. It buys nothing:
  // the queried Extend/Override due-date affordance is driven by the backend
  // PROJECTION (consumed via the detail controller's `canChangeDueDate`),
  // never by this transition list. Covered end-to-end by the queried tests
  // in `routes/work-items/detail.controller.test.js`.
  test('mirrors exactly one sla-extend transition (queried is projection-only)', () => {
    const slaExtends = reAccreditationType.transitions.filter(
      (t) => t.actionId === 'sla-extend'
    )
    expect(slaExtends).toHaveLength(1)
    expect(slaExtends[0]).toMatchObject({
      displayName: 'Extend SLA',
      fromStateId: 'assessment-in-progress',
      toStateId: 'assessment-in-progress'
    })
    expect(slaExtends[0]).not.toHaveProperty('callerInvocable')
  })

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
      // Resolved server-side from the work item's audit history. All four
      // share `fromStateId: 'updated'`, so a caller-chosen action could
      // send the application to the wrong stage.
      callerInvocable: false
    })
  })

  // RA-372. Exhaustive against the whole non-caller-invocable set, not just
  // the ones any one ticket added. RA-410 grew it from nine to eleven:
  // `submit-for-decision` and `reject` joined, because both hops of a
  // decision are now applied server-side by the `/decision` endpoint.
  //
  // Getting this wrong is a live security regression, not a cosmetic
  // mismatch: dropping the flag from any of the eight would make the
  // mirror advertise a set of same-from-state transitions as caller-
  // choosable, i.e. as if the user could pick the destination state.
  test('flags exactly the eleven server-resolved transitions the backend does', () => {
    const serverResolved = reAccreditationType.transitions
      .filter((t) => t.callerInvocable === false)
      .map((t) => t.actionId)
      .sort()

    expect(serverResolved).toEqual([
      // RA-410. Frontend-only, and non-invocable because the decision
      // endpoint applies it — never the generic action route.
      'approve',
      'continue-review-during-assessment',
      'continue-review-during-decision',
      'continue-review-during-duly-made',
      'continue-review-during-duly-making',
      // RA-316. Server-resolved for a different reason from the others:
      // not because the caller could pick the wrong target, but because
      // duly making carries a payment date that the generic
      // `/actions/{actionId}` route has nowhere to put.
      'duly-make',
      // RA-410. Same reasoning as `approve` above.
      'reject',
      'resume-during-assessment',
      'resume-during-decision',
      'resume-during-duly-made',
      'resume-during-duly-making',
      'submit-for-decision'
    ])
  })

  // ⚠ DO NOT DELETE THE `approve` TRANSITION. It looks like mirror drift
  // — the backend deliberately omits `approve` from
  // `ReAccreditationType.Transitions` so its generic engine refuses
  // `/actions/approve` — and RA-372 removed it on exactly that reasoning
  // before restoring it.
  //
  // It is load-bearing on THIS side: RA-410's `decision/eligibility.js`
  // reads this declaration to work out which states a decision may be taken
  // from and which terminal state each outcome lands on. Deleting it strands
  // the Log decision CTA — and because the deletion merges CLEANLY rather
  // than conflicting, nothing else would flag it. `decision/eligibility.test.js`
  // guards the same declaration from the consumer side; this is the
  // declaration-side guard.
  test('still declares the approve transition the decision flow depends on', () => {
    expect(
      reAccreditationType.transitions.find((t) => t.actionId === 'approve')
    ).toMatchObject({
      fromStateId: 'awaiting-decision',
      toStateId: 'approved',
      callerInvocable: false
    })
  })

  // RA-410. `reject` keeps its id, its states and its "Reject" displayName.
  // The user-visible rename to "Refused" is a label on the decision page's
  // radio and nothing else — renaming the declaration would desynchronise
  // the mirror to purely cosmetic effect.
  test('reject keeps its unchanged id, states and displayName', () => {
    expect(
      reAccreditationType.transitions.find((t) => t.actionId === 'reject')
    ).toMatchObject({
      displayName: 'Reject',
      fromStateId: 'awaiting-decision',
      toStateId: 'rejected',
      callerInvocable: false
    })
  })

  // RA-410. The marker the generic self-assign handler keys on. Paired with
  // `fromStateId`, it is what makes "Assign to yourself and start" start
  // something in `duly-made` and stay a plain assignment everywhere else.
  test('payment-received is the ONLY transition marked startsOnSelfAssign', () => {
    expect(
      reAccreditationType.transitions
        .filter((t) => t.startsOnSelfAssign === true)
        .map((t) => [t.actionId, t.fromStateId])
    ).toEqual([['payment-received', 'duly-made']])
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
      // RA-351. Exactly ONE `sla-extend` here, on `assessment-in-progress`.
      // The backend's transition set also has an `sla-extend` self-loop on
      // `queried`, but the FE framework keys transition `actionId`
      // uniqueness globally (`assertValidWorkItemModule`), so the queried
      // one is deliberately NOT mirrored — see the comment on the
      // `sla-extend` transition in module.js. The queried Extend/Override
      // affordance is driven by the backend PROJECTION into `availableActions`
      // (consumed via `canChangeDueDate`), not by this transition list.
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

  // RA-410. Every `getTasksForState` suite that stood here is gone with the
  // member itself — the type no longer declares one. What replaced the task
  // checklists is the three-CTA flow, covered by `decision/*.test.js`,
  // `duly-making/*.test.js` and the self-assign tests in
  // `routes/work-items/detail.controller.test.js`.
  test('no longer declares getTasksForState', () => {
    expect(reAccreditationType.getTasksForState).toBeUndefined()
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

    test('always mounts the RA-410 log-decision routes regardless of the create flag', async () => {
      for (const flag of [true, false]) {
        config.set(flagKey, flag)
        const server = { route: vi.fn() }
        await reAccreditationModule.register(server)
        const approvalCall = server.route.mock.calls.find(([routes]) =>
          routes.some(
            (r) => r.path === '/work-items/re-accreditation/{id}/decision'
          )
        )
        expect(approvalCall).toBeDefined()
        const methods = approvalCall[0].map((r) => `${r.method} ${r.path}`)
        expect(methods).toContain(
          'GET /work-items/re-accreditation/{id}/decision'
        )
        expect(methods).toContain(
          'POST /work-items/re-accreditation/{id}/decision'
        )
      }
    })

    test('does not mount the create routes when the flag is off', async () => {
      config.set(flagKey, false)
      const server = { route: vi.fn() }
      await reAccreditationModule.register(server)
      // Only the always-on decision (RA-410), continue-review (RA-372) and
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
