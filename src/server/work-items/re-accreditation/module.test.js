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
    expect(reAccreditationType.templateVersion).toBe('v18')
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
      // RA-527 follow-up (v18). A started case still reads "Duly made".
      'assessment-started': 'Duly made',
      'assessment-in-progress': 'Updated',
      'awaiting-decision': 'Awaiting decision',
      queried: 'Queried',
      updated: 'Updated',
      // RA-527. Step 1 of an approval: approved, applicant not yet contacted.
      'approved-pending-contact': 'Approved',
      approved: 'Granted',
      // RA-527. Step 1 of a refusal: refused, applicant not yet contacted.
      'rejected-pending-contact': 'Refused',
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
    expect(states['assessment-started'].isTerminal).toBeFalsy()
    expect(states['assessment-in-progress'].isTerminal).toBeFalsy()
    expect(states['awaiting-decision'].isTerminal).toBeFalsy()
    // RA-291: a queried application is paused awaiting the operator's
    // resubmission, so it must stay non-terminal.
    expect(states.queried.isTerminal).toBeFalsy()
    // RA-337: a resumed-but-not-yet-reviewed application is likewise not
    // a closed outcome.
    expect(states.updated.isTerminal).toBeFalsy()
    // RA-527: an approval awaiting applicant contact is not yet applied.
    expect(states['approved-pending-contact'].isTerminal).toBeFalsy()
    expect(states['rejected-pending-contact'].isTerminal).toBeFalsy()
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
    ['start-assessment', 'duly-made', 'assessment-started'],
    ['sla-extend', 'assessment-in-progress', 'assessment-in-progress'],
    ['submit-for-decision', 'assessment-in-progress', 'awaiting-decision'],
    // RA-527. Step 1 of an approval lands in the pending-contact state.
    [
      'make-determination-approved',
      'awaiting-decision',
      'approved-pending-contact'
    ],
    // RA-527. So does step 1 of a refusal, and step 2 applies it.
    [
      'make-determination-rejected',
      'awaiting-decision',
      'rejected-pending-contact'
    ],
    ['confirm-contact-rejected', 'rejected-pending-contact', 'rejected'],
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
    // RA-523 (v14): the duly-made origin resumes straight into assessment.
    ['resume-during-duly-made', 'queried', 'assessment-in-progress'],
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
      displayName: 'Extend determination deadline',
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
  // RA-595 briefly made it twelve with a retired `payment-received`; v16
  // removed it from management-be, so it is gone here too. RA-527 (v17)
  // swapped the frontend-only `approve` for the backend's real step 1
  // transition, `make-determination-approved`, and the refusal's two steps
  // replaced `reject`.
  //
  // Getting this wrong is a live security regression, not a cosmetic
  // mismatch: dropping the flag from any of the eight would make the
  // mirror advertise a set of same-from-state transitions as caller-
  // choosable, i.e. as if the user could pick the destination state.
  test('flags exactly the server-resolved transitions the backend does', () => {
    const serverResolved = reAccreditationType.transitions
      .filter((t) => t.callerInvocable === false)
      .map((t) => t.actionId)
      .sort()

    expect(serverResolved).toEqual([
      // RA-527. Step 2 of an approval: the confirm-contact endpoint applies
      // it, because it pushes to the operator journey before the write.
      'confirm-contact-approved',
      'confirm-contact-rejected',
      'continue-review-during-assessment',
      'continue-review-during-decision',
      'continue-review-during-duly-made',
      'continue-review-during-duly-making',
      // RA-316. Server-resolved for a different reason from the others:
      // not because the caller could pick the wrong target, but because
      // duly making carries a payment date that the generic
      // `/actions/{actionId}` route has nowhere to put.
      'duly-make',
      // RA-527. Step 1 of an approval: the decision endpoint applies it,
      // because it mints the accreditation number in the same write.
      'make-determination-approved',
      // RA-527. Step 1 of a refusal, also applied by the decision endpoint.
      'make-determination-rejected',
      'resume-during-assessment',
      'resume-during-decision',
      'resume-during-duly-made',
      'resume-during-duly-making',
      'submit-for-decision'
    ])
  })

  // RA-527. The decision flow reads this declaration (see
  // `decision/eligibility.js`) to work out which state an Approved decision
  // is taken from. It replaced the frontend-only `approve` entry RA-410
  // relied on: management-be now declares the step 1 transition itself, so
  // the mirror is one-for-one with the backend again.
  test('declares the step 1 approval transition the decision flow depends on', () => {
    expect(
      reAccreditationType.transitions.find(
        (t) => t.actionId === 'make-determination-approved'
      )
    ).toMatchObject({
      fromStateId: 'awaiting-decision',
      toStateId: 'approved-pending-contact',
      callerInvocable: false
    })
    expect(
      reAccreditationType.transitions.find((t) => t.actionId === 'approve')
    ).toBeUndefined()
  })

  // RA-527. Step 2 of an approval, mirrored from management-be v17: the only
  // way out of `approved-pending-contact`, applied by the confirm-contact
  // endpoint.
  test('declares the step 2 confirm-contact transition out of approved-pending-contact', () => {
    expect(
      reAccreditationType.transitions.filter(
        (t) => t.fromStateId === 'approved-pending-contact'
      )
    ).toEqual([
      {
        actionId: 'confirm-contact-approved',
        displayName: 'Confirm applicant contact',
        fromStateId: 'approved-pending-contact',
        toStateId: 'approved',
        callerInvocable: false
      }
    ])
  })

  // RA-527. A refusal takes the same two steps, mirrored from
  // management-be v17, which removed the single-step `reject`.
  test('declares the two refusal steps and no single-step reject', () => {
    expect(
      reAccreditationType.transitions.find(
        (t) => t.actionId === 'make-determination-rejected'
      )
    ).toMatchObject({
      fromStateId: 'awaiting-decision',
      toStateId: 'rejected-pending-contact',
      callerInvocable: false
    })
    expect(
      reAccreditationType.transitions.filter(
        (t) => t.fromStateId === 'rejected-pending-contact'
      )
    ).toEqual([
      {
        actionId: 'confirm-contact-rejected',
        displayName: 'Confirm applicant contact',
        fromStateId: 'rejected-pending-contact',
        toStateId: 'rejected',
        callerInvocable: false
      }
    ])
    expect(
      reAccreditationType.transitions.find((t) => t.actionId === 'reject')
    ).toBeUndefined()
  })

  // RA-410. The marker the generic self-assign handler keys on. Paired with
  // `fromStateId`, it is what makes "Assign to yourself and start" start
  // something in `duly-made` and stay a plain assignment everywhere else.
  //
  // RA-595 ("switch" step). The marker moved from `payment-received` to
  // `start-assessment` ("Assessment started"), mirroring management-be v15.
  test('start-assessment is the ONLY transition marked startsOnSelfAssign', () => {
    expect(
      reAccreditationType.transitions
        .filter((t) => t.startsOnSelfAssign === true)
        .map((t) => [t.actionId, t.fromStateId])
    ).toEqual([['start-assessment', 'duly-made']])
  })

  // RA-527 follow-up: management-be v18 retargeted it to
  // `assessment-started`, so starting a case keeps it "Duly made".
  test('start-assessment mirrors the backend v18 transition', () => {
    expect(
      reAccreditationType.transitions.find(
        (t) => t.actionId === 'start-assessment'
      )
    ).toMatchObject({
      displayName: 'Assessment started',
      fromStateId: 'duly-made',
      toStateId: 'assessment-started'
    })
  })

  // RA-527 follow-up. Mirrors the backend's guard: nothing but the start
  // enters the started state, so no route leads back to "Duly made".
  test('only start-assessment enters assessment-started', () => {
    expect(
      reAccreditationType.transitions
        .filter((t) => t.toStateId === 'assessment-started')
        .map((t) => t.actionId)
    ).toEqual(['start-assessment'])
  })

  // RA-527 follow-up. Declared straight after `duly-made`, as the backend
  // does (its status sort rank is the declaration order).
  test('declares assessment-started straight after duly-made', () => {
    const ids = reAccreditationType.states.map((s) => s.id)
    expect(ids[ids.indexOf('duly-made') + 1]).toBe('assessment-started')
  })

  // RA-595 ("remove" step). management-be v16 no longer declares or projects
  // `payment-received`, so the retired declaration that hid it is gone too.
  // `start-assessment` is the only way from Duly made into assessment.
  test('no longer declares payment-received', () => {
    expect(
      reAccreditationType.transitions.find(
        (t) => t.actionId === 'payment-received'
      )
    ).toBeUndefined()
    expect(
      reAccreditationType.transitions
        .filter(
          (t) =>
            t.fromStateId === 'duly-made' &&
            ['assessment-started', 'assessment-in-progress'].includes(
              t.toStateId
            )
        )
        .map((t) => t.actionId)
    ).toEqual(['start-assessment'])
  })

  // The whole mirror, pinned in one place. RA-372 found it three blocks
  // short; this is what stops that recurring silently.
  //
  // RA-527 removed the one KNOWN divergence (the frontend-only `approve`):
  // this is one-for-one with `ReAccreditationType.Transitions`, apart from
  // the queried `sla-extend` self-loop noted below.
  test('pins the full declared transition set (the backend set)', () => {
    expect(
      reAccreditationType.transitions.map((t) => t.actionId).sort()
    ).toEqual([
      'confirm-contact-approved',
      'confirm-contact-rejected',
      'continue-review-during-assessment',
      'continue-review-during-decision',
      'continue-review-during-duly-made',
      'continue-review-during-duly-making',
      'duly-make',
      'make-determination-approved',
      'make-determination-rejected',
      'query-during-assessment',
      'query-during-decision',
      'query-during-duly-made',
      'query-during-duly-making',
      'resume-during-assessment',
      'resume-during-decision',
      'resume-during-duly-made',
      'resume-during-duly-making',
      // RA-351. Exactly ONE `sla-extend`, on `assessment-in-progress`; the
      // backend's queried `sla-extend` self-loop is deliberately not mirrored
      // (see the module.js transition comment and the dedicated test above).
      'sla-extend',
      'start-assessment',
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
      // only mounted when the flag is on. RA-523 removed the bespoke
      // payment-received route, dropping the always-on count from four
      // to three; RA-527's confirm-contact routes brought it back to four.
      // RA-576 adds the change-payment-date routes.
      expect(server.route).toHaveBeenCalledTimes(6)
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

    // RA-527.
    test('always mounts the confirm-contact routes regardless of the create flag', async () => {
      for (const flag of [true, false]) {
        config.set(flagKey, flag)
        const server = { route: vi.fn() }
        await reAccreditationModule.register(server)
        const methods = server.route.mock.calls
          .flatMap(([routes]) => routes)
          .map((r) => `${r.method} ${r.path}`)
        expect(methods).toContain(
          'GET /work-items/re-accreditation/{id}/confirm-contact'
        )
        expect(methods).toContain(
          'POST /work-items/re-accreditation/{id}/confirm-contact'
        )
      }
    })

    test('does not mount the create routes when the flag is off', async () => {
      config.set(flagKey, false)
      const server = { route: vi.fn() }
      await reAccreditationModule.register(server)
      // Only the always-on decision (RA-410), confirm-contact (RA-527),
      // continue-review (RA-372), duly-making (RA-316) and change-payment-date
      // (RA-576) routes are mounted.
      expect(server.route).toHaveBeenCalledTimes(5)
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

describe('RA-576 change-payment-date routes', () => {
  test('are always mounted, regardless of the create flag', async () => {
    for (const flag of [true, false]) {
      config.set('featureFlags.workItemCreationEnabled', flag)
      const server = { route: vi.fn() }
      await reAccreditationModule.register(server)
      const call = server.route.mock.calls.find(([routes]) =>
        routes.some(
          (r) =>
            r.path === '/work-items/re-accreditation/{id}/change-payment-date'
        )
      )
      expect(call).toBeDefined()
      expect(call[0].map((r) => `${r.method} ${r.path}`)).toEqual([
        'GET /work-items/re-accreditation/{id}/change-payment-date',
        'POST /work-items/re-accreditation/{id}/change-payment-date'
      ])
    }
  })
})
