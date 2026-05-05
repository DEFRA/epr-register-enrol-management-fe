import { describe, test, expect, beforeEach, vi } from 'vitest'
import hapi from '@hapi/hapi'

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
    expect(reAccreditationType.templateVersion).toBe('v1')
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
    ['start-assessment', 'submitted', 'assessment-in-progress', true],
    [
      'submit-for-decision',
      'assessment-in-progress',
      'awaiting-decision',
      true
    ],
    ['approve', 'awaiting-decision', 'approved', true],
    ['reject', 'awaiting-decision', 'rejected', true],
    ['withdraw', 'submitted', 'withdrawn', false],
    ['withdraw-during-assessment', 'assessment-in-progress', 'withdrawn', false]
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
      ['verify-organisation-details', 'confirm-registration-fee-paid']
    ],
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

  test('register registers a v1 detail template resolvable from the framework', async () => {
    // Resolve falls back to the generic detail before register runs.
    expect(resolveDetailTemplate('re-accreditation', 'v1')).toBe(
      'work-items/detail'
    )

    const server = hapi.server()
    await reAccreditationModule.register(server)

    expect(resolveDetailTemplate('re-accreditation', 'v1')).toBe(
      're-accreditation/detail-v1'
    )
  })

  test('register does not throw when called with a stub server', async () => {
    const server = { route: vi.fn() }
    await expect(
      reAccreditationModule.register(server)
    ).resolves.toBeUndefined()
  })
})
