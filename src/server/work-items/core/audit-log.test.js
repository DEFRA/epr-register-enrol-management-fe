import { describe, expect, test } from 'vitest'
import {
  decorateAuditLog,
  summariseAuditEntry
} from './audit-log.js'

describe('summariseAuditEntry', () => {
  test('returns task display name for a task-completed entry', () => {
    expect(
      summariseAuditEntry({
        action: 'task-completed',
        details: { taskId: 'check-eligibility', taskDisplayName: 'Check eligibility' }
      })
    ).toBe('Check eligibility')
  })

  test('falls back to task id when display name is missing', () => {
    expect(
      summariseAuditEntry({
        action: 'task-completed',
        details: { taskId: 'check-eligibility' }
      })
    ).toBe('check-eligibility')
  })

  test('renders an action-applied entry as "Action (from -> to)"', () => {
    expect(
      summariseAuditEntry({
        action: 'action-applied',
        details: {
          actionId: 'approve',
          actionDisplayName: 'Approve',
          fromStateId: 'submitted',
          toStateId: 'approved'
        }
      })
    ).toBe('Approve (submitted → approved)')
  })

  test('renders an assignment entry showing the new assignee and the previous one', () => {
    expect(
      summariseAuditEntry({
        action: 'assigned',
        details: {
          assigneeId: 'carol-1',
          assigneeName: 'Carol',
          previousAssigneeId: 'bob-1',
          previousAssigneeName: 'Bob'
        }
      })
    ).toBe('Bob → Carol')
  })

  test('renders a self-assign (no previous assignee) as just the new assignee', () => {
    expect(
      summariseAuditEntry({
        action: 'assigned',
        details: { assigneeId: 'alice-1', assigneeName: 'Alice' }
      })
    ).toBe('Alice')
  })

  test('renders an unassigned entry showing the previous assignee', () => {
    expect(
      summariseAuditEntry({
        action: 'unassigned',
        details: { previousAssigneeId: 'alice-1', previousAssigneeName: 'Alice' }
      })
    ).toBe('was Alice')
  })

  test('returns an empty string for note-added (display name carries the meaning)', () => {
    expect(
      summariseAuditEntry({ action: 'note-added', details: { noteId: 'x' } })
    ).toBe('')
  })

  test('returns an empty string for unknown actions and bad input', () => {
    expect(summariseAuditEntry({ action: 'something-else', details: {} })).toBe('')
    expect(summariseAuditEntry(null)).toBe('')
    expect(summariseAuditEntry({})).toBe('')
  })
})

describe('decorateAuditLog', () => {
  test('returns an empty array when given a non-array', () => {
    expect(decorateAuditLog(undefined)).toEqual([])
    expect(decorateAuditLog(null)).toEqual([])
  })

  test('preserves order and adds a summary string per entry', () => {
    const entries = [
      {
        id: '1',
        action: 'note-added',
        actionDisplayName: 'Note added',
        details: { noteId: 'n-1' },
        createdAt: '2026-04-27T09:00:00Z'
      },
      {
        id: '2',
        action: 'action-applied',
        actionDisplayName: 'Action applied',
        details: {
          actionId: 'approve',
          actionDisplayName: 'Approve',
          fromStateId: 'submitted',
          toStateId: 'approved'
        },
        createdAt: '2026-04-27T10:00:00Z'
      }
    ]
    const decorated = decorateAuditLog(entries)
    expect(decorated.map((e) => e.id)).toEqual(['1', '2'])
    expect(decorated[0].summary).toBe('')
    expect(decorated[1].summary).toBe('Approve (submitted → approved)')
    // Original fields are preserved.
    expect(decorated[1].createdAt).toBe('2026-04-27T10:00:00Z')
  })
})
