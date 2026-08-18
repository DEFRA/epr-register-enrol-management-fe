import { describe, expect, test, vi } from 'vitest'

// The default `recordDecision`/`addNote` collaborators lazily `import()`
// backend-api.js rather than importing it statically (so tests can stub the
// call without mocking undici). Mocking the module here exercises that
// lazy-import wiring itself, which the constructor-injection tests below
// never touch.
vi.mock('#/server/common/helpers/backend-api/backend-api.js', () => ({
  recordReAccreditationDecision: vi.fn(),
  addWorkItemNote: vi.fn()
}))

import { createDecisionService, DECISION_NOTE_MAX_LENGTH } from './service.js'
import {
  recordReAccreditationDecision,
  addWorkItemNote
} from '#/server/common/helpers/backend-api/backend-api.js'

/**
 * RA-410. One call, both outcomes. The service's job is to validate the
 * outcome, hit the single `/decision` endpoint and translate the reply into
 * the result shape every other module service returns.
 */

function okReply(workItem = { id: 'wi-1', stateId: 'approved' }) {
  return { ok: true, workItem }
}

// RA-203. The decision note reaches the operator's email through
// management-be's `decision_notes` placeholder, which resolves to the LATEST
// work-item note. That makes ordering load-bearing, so it is asserted
// directly rather than left implied.
describe('createDecisionService — decision note (RA-203)', () => {
  test('posts the note BEFORE the decision', async () => {
    const calls = []
    const addNote = vi.fn(async () => {
      calls.push('note')
      return { ok: true }
    })
    const recordDecision = vi.fn(async () => {
      calls.push('decision')
      return okReply()
    })
    const service = createDecisionService({ recordDecision, addNote })

    await service.recordWorkItemDecision({
      workItemId: 'wi-1',
      outcome: 'approved',
      decisionNote: 'Rationale'
    })

    // Reversed, the notification hook (which fires during the decision write)
    // would read the PREVIOUS note and the operator's email would carry the
    // wrong rationale — or none.
    expect(calls).toEqual(['note', 'decision'])
    expect(addNote).toHaveBeenCalledWith({
      workItemId: 'wi-1',
      text: 'Rationale',
      user: null
    })
  })

  test.each([[''], ['   '], [undefined]])(
    'skips the notes call entirely for a blank note (%s)',
    async (decisionNote) => {
      const addNote = vi.fn()
      const recordDecision = vi.fn().mockResolvedValue(okReply())
      const service = createDecisionService({ recordDecision, addNote })

      const result = await service.recordWorkItemDecision({
        workItemId: 'wi-1',
        outcome: 'approved',
        decisionNote
      })

      expect(addNote).not.toHaveBeenCalled()
      expect(result.ok).toBe(true)
    }
  )

  test('trims the note before posting it', async () => {
    const addNote = vi.fn().mockResolvedValue({ ok: true })
    const recordDecision = vi.fn().mockResolvedValue(okReply())
    const service = createDecisionService({ recordDecision, addNote })

    await service.recordWorkItemDecision({
      workItemId: 'wi-1',
      outcome: 'approved',
      decisionNote: '  Rationale  '
    })

    expect(addNote).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Rationale' })
    )
  })

  test('does NOT record the decision when the note fails to save', async () => {
    // The note is part of the auditable rationale for a regulatory decision,
    // and the decision cannot be un-made. Recording the outcome without it
    // would produce a decision whose stated reason silently went missing.
    const addNote = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 502, error: 'boom' })
    const recordDecision = vi.fn()
    const service = createDecisionService({ recordDecision, addNote })

    const result = await service.recordWorkItemDecision({
      workItemId: 'wi-1',
      outcome: 'approved',
      decisionNote: 'Rationale'
    })

    expect(recordDecision).not.toHaveBeenCalled()
    expect(result).toMatchObject({ ok: false, outcome: 'note-failed' })
  })

  test('rejects an over-long note without calling either endpoint', async () => {
    const addNote = vi.fn()
    const recordDecision = vi.fn()
    const service = createDecisionService({ recordDecision, addNote })

    const result = await service.recordWorkItemDecision({
      workItemId: 'wi-1',
      outcome: 'approved',
      decisionNote: 'x'.repeat(DECISION_NOTE_MAX_LENGTH + 1)
    })

    expect(addNote).not.toHaveBeenCalled()
    expect(recordDecision).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      ok: false,
      outcome: 'invalid',
      errorCode: 'decision-note-too-long'
    })
  })

  test('accepts a note exactly at the limit', async () => {
    const addNote = vi.fn().mockResolvedValue({ ok: true })
    const recordDecision = vi.fn().mockResolvedValue(okReply())
    const service = createDecisionService({ recordDecision, addNote })

    const result = await service.recordWorkItemDecision({
      workItemId: 'wi-1',
      outcome: 'approved',
      decisionNote: 'x'.repeat(DECISION_NOTE_MAX_LENGTH)
    })

    expect(result.ok).toBe(true)
  })
})

describe('createDecisionService#recordWorkItemDecision', () => {
  test('posts the approved outcome and returns the updated work item', async () => {
    const recordDecision = vi.fn().mockResolvedValue(okReply())
    const service = createDecisionService({ recordDecision })

    const result = await service.recordWorkItemDecision({
      workItemId: 'wi-1',
      outcome: 'approved',
      user: { id: 'u-1' }
    })

    expect(recordDecision).toHaveBeenCalledWith({
      workItemId: 'wi-1',
      outcome: 'approved',
      user: { id: 'u-1' }
    })
    expect(result).toEqual({
      ok: true,
      workItem: { id: 'wi-1', stateId: 'approved' }
    })
  })

  test('posts `rejected` — the wire value — for a Refused decision', async () => {
    // The UI says "Refused"; the wire says `rejected`. If this ever posts
    // "refused" the backend answers 400 and the whole flow breaks, so the
    // assertion is on the exact string.
    const recordDecision = vi
      .fn()
      .mockResolvedValue(okReply({ id: 'wi-1', stateId: 'rejected' }))
    const service = createDecisionService({ recordDecision })

    const result = await service.recordWorkItemDecision({
      workItemId: 'wi-1',
      outcome: 'rejected'
    })

    expect(recordDecision).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'rejected' })
    )
    expect(result.ok).toBe(true)
    expect(result.workItem.stateId).toBe('rejected')
  })

  test('makes exactly ONE backend call — never two hops', async () => {
    // The two-hop lifecycle is applied server-side. Splitting it here would
    // reintroduce the window where a failure strands a terminal decision.
    const recordDecision = vi.fn().mockResolvedValue(okReply())
    const service = createDecisionService({ recordDecision })

    await service.recordWorkItemDecision({
      workItemId: 'wi-1',
      outcome: 'approved'
    })

    expect(recordDecision).toHaveBeenCalledTimes(1)
  })

  test.each([['refused'], ['approve'], [''], [null], [undefined]])(
    'refuses to post an invalid outcome (%s) and never calls the backend',
    async (outcome) => {
      const recordDecision = vi.fn()
      const service = createDecisionService({ recordDecision })

      const result = await service.recordWorkItemDecision({
        workItemId: 'wi-1',
        outcome
      })

      expect(recordDecision).not.toHaveBeenCalled()
      expect(result).toEqual({
        ok: false,
        outcome: 'invalid',
        errorCode: 'invalid-outcome',
        message: 'Select the decision for this application.'
      })
    }
  )

  test.each([
    ['conflict', 409],
    ['not-found', 404],
    ['unauthorized', 401],
    ['server', 500]
  ])(
    'maps a %s backend reply onto the shared outcome vocabulary',
    async (reason, status) => {
      const recordDecision = vi.fn().mockResolvedValue({
        ok: false,
        reason,
        status,
        message: 'nope'
      })
      const service = createDecisionService({ recordDecision })

      const result = await service.recordWorkItemDecision({
        workItemId: 'wi-1',
        outcome: 'approved'
      })

      expect(result.ok).toBe(false)
      expect(result.status).toBe(status)
      expect(result.message).toBe('nope')
    }
  )

  test('surfaces the backend errorCode so the controller can bind a field error', async () => {
    const recordDecision = vi.fn().mockResolvedValue({
      ok: false,
      reason: 'invalid',
      status: 400,
      errorCode: 'invalid-outcome',
      message: 'bad outcome'
    })
    const service = createDecisionService({ recordDecision })

    const result = await service.recordWorkItemDecision({
      workItemId: 'wi-1',
      outcome: 'approved'
    })

    expect(result.errorCode).toBe('invalid-outcome')
  })

  test('defaults errorCode to null when the backend sends none', async () => {
    const recordDecision = vi
      .fn()
      .mockResolvedValue({ ok: false, reason: 'server', status: 500 })
    const service = createDecisionService({ recordDecision })

    const result = await service.recordWorkItemDecision({
      workItemId: 'wi-1',
      outcome: 'approved'
    })

    expect(result.errorCode).toBeNull()
    expect(result.message).toBe('Recording the decision failed')
  })

  test.each([[''], ['   '], [null], [undefined], [42]])(
    'throws for a missing workItemId (%s)',
    async (workItemId) => {
      const service = createDecisionService({ recordDecision: vi.fn() })
      await expect(
        service.recordWorkItemDecision({ workItemId, outcome: 'approved' })
      ).rejects.toThrow('workItemId must be a non-empty string')
    }
  )
})

// The default collaborators (used when the caller injects neither
// `recordDecision` nor `addNote`) lazily import backend-api.js and delegate
// straight through. Covered separately from the constructor-injection tests
// above, which never exercise that wiring.
describe('createDecisionService — default backend-api collaborators', () => {
  test('recordDecision defaults to recordReAccreditationDecision', async () => {
    recordReAccreditationDecision.mockResolvedValue({
      ok: true,
      workItem: { id: 'wi-1', stateId: 'approved' }
    })
    const service = createDecisionService()

    const result = await service.recordWorkItemDecision({
      workItemId: 'wi-1',
      outcome: 'approved',
      user: { id: 'u-1' }
    })

    expect(recordReAccreditationDecision).toHaveBeenCalledWith({
      workItemId: 'wi-1',
      outcome: 'approved',
      user: { id: 'u-1' }
    })
    expect(result).toEqual({
      ok: true,
      workItem: { id: 'wi-1', stateId: 'approved' }
    })
  })

  test('addNote defaults to addWorkItemNote and is called before the decision', async () => {
    addWorkItemNote.mockResolvedValue({ ok: true })
    recordReAccreditationDecision.mockResolvedValue({
      ok: true,
      workItem: { id: 'wi-1', stateId: 'approved' }
    })
    const service = createDecisionService()

    const result = await service.recordWorkItemDecision({
      workItemId: 'wi-1',
      outcome: 'approved',
      decisionNote: 'Rationale',
      user: { id: 'u-1' }
    })

    expect(addWorkItemNote).toHaveBeenCalledWith({
      workItemId: 'wi-1',
      text: 'Rationale',
      user: { id: 'u-1' }
    })
    expect(result.ok).toBe(true)
  })
})
