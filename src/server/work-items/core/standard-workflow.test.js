import { describe, expect, test } from 'vitest'

import {
  STATE_APPROVED_PENDING_CONTACT,
  STATE_REJECTED_PENDING_CONTACT,
  standardWorkflow
} from './standard-workflow.js'

const { states, transitions } = standardWorkflow
const stateIds = states.map((state) => state.id)

function transition(actionId) {
  return transitions.find((t) => t.actionId === actionId)
}

describe('standardWorkflow (RA-739)', () => {
  test('is the frozen Standard workflow', () => {
    expect(standardWorkflow.id).toBe('standard')
    expect(Object.isFrozen(standardWorkflow)).toBe(true)
  })

  test('starts in Not started, one of its own states', () => {
    expect(standardWorkflow.initialState).toEqual({
      id: 'submitted',
      displayName: 'Not started'
    })
    expect(states).toContain(standardWorkflow.initialState)
  })

  test('declares each state id once', () => {
    expect(new Set(stateIds).size).toBe(stateIds.length)
  })

  test('labels each state as the Applications page does (RA-324)', () => {
    expect(
      Object.fromEntries(states.map((state) => [state.id, state.displayName]))
    ).toEqual({
      submitted: 'Not started',
      'duly-made': 'Duly made',
      'assessment-started': 'Duly made',
      'assessment-in-progress': 'Updated',
      'awaiting-decision': 'Awaiting decision',
      queried: 'Queried',
      updated: 'Updated',
      'approved-pending-contact': 'Approved',
      approved: 'Granted',
      'rejected-pending-contact': 'Refused',
      rejected: 'Refused',
      withdrawn: 'Withdrawn'
    })
  })

  test('has Granted, Refused and Withdrawn as its only terminal states', () => {
    expect(
      states.filter((state) => state.isTerminal).map((state) => state.id)
    ).toEqual(['approved', 'rejected', 'withdrawn'])
  })

  test('exports the two pending-contact state ids, neither terminal (RA-527)', () => {
    for (const id of [
      STATE_APPROVED_PENDING_CONTACT,
      STATE_REJECTED_PENDING_CONTACT
    ]) {
      const state = states.find((s) => s.id === id)
      expect(state).toBeDefined()
      expect(state.isTerminal).toBeUndefined()
    }
  })

  test.each(transitions.map((t) => [t.actionId, t]))(
    '%s goes between declared states',
    (_, t) => {
      expect(stateIds).toContain(t.fromStateId)
      expect(stateIds).toContain(t.toStateId)
    }
  )

  test('has no transition out of a terminal state', () => {
    const terminal = new Set(
      states.filter((state) => state.isTerminal).map((state) => state.id)
    )
    expect(transitions.filter((t) => terminal.has(t.fromStateId))).toEqual([])
  })

  test('declares each action id once across the whole workflow', () => {
    const actionIds = transitions.map((t) => t.actionId)
    expect(new Set(actionIds).size).toBe(actionIds.length)
  })

  test('marks exactly the backend-only transitions not caller-invocable', () => {
    expect(
      transitions
        .filter((t) => t.callerInvocable === false)
        .map((t) => t.actionId)
        .sort()
    ).toEqual(
      [
        'duly-make',
        'submit-for-decision',
        'make-determination-approved',
        'confirm-contact-approved',
        'make-determination-rejected',
        'confirm-contact-rejected',
        'resume-during-duly-making',
        'resume-during-duly-made',
        'resume-during-assessment',
        'resume-during-decision',
        'continue-review-during-duly-making',
        'continue-review-during-duly-made',
        'continue-review-during-assessment',
        'continue-review-during-decision'
      ].sort()
    )
    expect(
      transitions.filter(
        (t) => t.callerInvocable !== undefined && t.callerInvocable !== false
      )
    ).toEqual([])
  })

  test('starts assessment on self-assign only from Duly made (RA-410, RA-595)', () => {
    const starts = transitions.filter((t) => t.startsOnSelfAssign)
    expect(starts).toHaveLength(1)
    expect(starts[0]).toMatchObject({
      actionId: 'start-assessment',
      fromStateId: 'duly-made',
      toStateId: 'assessment-started',
      startRetryHint: expect.any(String)
    })
    expect(starts[0].callerInvocable).toBeUndefined()
  })

  test('Duly make moves Not started to Duly made', () => {
    expect(transition('duly-make')).toMatchObject({
      fromStateId: 'submitted',
      toStateId: 'duly-made'
    })
  })

  test('takes a determination in two steps for both outcomes (RA-527)', () => {
    expect(transition('make-determination-approved')).toMatchObject({
      fromStateId: 'awaiting-decision',
      toStateId: STATE_APPROVED_PENDING_CONTACT
    })
    expect(transition('confirm-contact-approved')).toMatchObject({
      fromStateId: STATE_APPROVED_PENDING_CONTACT,
      toStateId: 'approved'
    })
    expect(transition('make-determination-rejected')).toMatchObject({
      fromStateId: 'awaiting-decision',
      toStateId: STATE_REJECTED_PENDING_CONTACT
    })
    expect(transition('confirm-contact-rejected')).toMatchObject({
      fromStateId: STATE_REJECTED_PENDING_CONTACT,
      toStateId: 'rejected'
    })
  })

  test('cannot query an application that is already queried', () => {
    const queries = transitions.filter((t) => t.toStateId === 'queried')
    expect(queries.map((t) => t.fromStateId)).not.toContain('queried')
  })

  test('continues review from Updated back to each stage a query can come from', () => {
    expect(
      transitions
        .filter(
          (t) => t.fromStateId === 'updated' && t.toStateId !== 'withdrawn'
        )
        .map((t) => t.toStateId)
    ).toEqual([
      'submitted',
      'duly-made',
      'assessment-in-progress',
      'awaiting-decision'
    ])
  })
})
