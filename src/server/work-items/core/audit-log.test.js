import { describe, expect, test } from 'vitest'
import {
  decorateAuditLog,
  detailRowsForAuditEntry,
  summariseAuditEntry
} from './audit-log.js'

describe('summariseAuditEntry', () => {
  test('returns task display name for a task-completed entry', () => {
    expect(
      summariseAuditEntry({
        action: 'task-completed',
        details: {
          taskId: 'check-eligibility',
          taskDisplayName: 'Check eligibility'
        }
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
        details: {
          previousAssigneeId: 'alice-1',
          previousAssigneeName: 'Alice'
        }
      })
    ).toBe('was Alice')
  })

  test('returns an empty string for note-added (display name carries the meaning)', () => {
    expect(
      summariseAuditEntry({ action: 'note-added', details: { noteId: 'x' } })
    ).toBe('')
  })

  test('returns an empty string for unknown actions and bad input', () => {
    expect(summariseAuditEntry({ action: 'something-else', details: {} })).toBe(
      ''
    )
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
    // Detail rows are projected alongside the summary so the template
    // can render a single disclosure per entry. The note has no body and
    // no actor here, so it has nothing extra to show; the action-applied
    // entry surfaces the action plus from/to states.
    expect(decorated[0].detailRows).toEqual([])
    expect(decorated[1].detailRows).toEqual([
      { key: 'Action', value: 'Approve' },
      { key: 'Previous state', value: 'submitted' },
      { key: 'New state', value: 'approved' }
    ])
    // Original fields are preserved.
    expect(decorated[1].createdAt).toBe('2026-04-27T10:00:00Z')
  })
})

describe('detailRowsForAuditEntry', () => {
  test('returns an empty array for null/undefined/non-objects', () => {
    expect(detailRowsForAuditEntry(null)).toEqual([])
    expect(detailRowsForAuditEntry(undefined)).toEqual([])
    expect(detailRowsForAuditEntry('nope')).toEqual([])
  })

  test('returns an empty array when no useful detail and no actor are available', () => {
    expect(
      detailRowsForAuditEntry({ action: 'task-completed', details: {} })
    ).toEqual([])
    expect(
      detailRowsForAuditEntry({ action: 'action-applied', details: {} })
    ).toEqual([])
    expect(
      detailRowsForAuditEntry({ action: 'something-else', details: {} })
    ).toEqual([])
  })

  test('projects type, initial state, template version and submitter for a work-item-submitted entry', () => {
    expect(
      detailRowsForAuditEntry({
        action: 'work-item-submitted',
        createdBy: 'frontend',
        createdByName: 'Acme submission',
        details: {
          typeId: 're-accreditation',
          stateId: 'submitted',
          templateVersion: 'v1'
        }
      })
    ).toEqual([
      { key: 'Type', value: 're-accreditation' },
      { key: 'Initial state', value: 'submitted' },
      { key: 'Template version', value: 'v1' },
      { key: 'Submitted by', value: 'Acme submission' }
    ])
  })

  test('projects task, state and actor for a task-completed entry', () => {
    expect(
      detailRowsForAuditEntry({
        action: 'task-completed',
        createdBy: 'alice-1',
        createdByName: 'Alice Anderson',
        details: {
          taskId: 'check-eligibility',
          taskDisplayName: 'Check eligibility',
          stateId: 'submitted'
        }
      })
    ).toEqual([
      { key: 'Task', value: 'Check eligibility' },
      { key: 'State', value: 'submitted' },
      { key: 'Completed by', value: 'Alice Anderson' }
    ])
  })

  test('projects action, from/to state and actor for an action-applied entry', () => {
    expect(
      detailRowsForAuditEntry({
        action: 'action-applied',
        createdBy: 'alice-1',
        createdByName: 'Alice Anderson',
        details: {
          actionId: 'approve',
          actionDisplayName: 'Approve',
          fromStateId: 'submitted',
          toStateId: 'approved'
        }
      })
    ).toEqual([
      { key: 'Action', value: 'Approve' },
      { key: 'Previous state', value: 'submitted' },
      { key: 'New state', value: 'approved' },
      { key: 'Applied by', value: 'Alice Anderson' }
    ])
  })

  test('projects the note body and actor for a note-added entry as a multiline row', () => {
    expect(
      detailRowsForAuditEntry({
        action: 'note-added',
        createdBy: 'alice-1',
        createdByName: 'Alice Anderson',
        details: { noteId: 'n-1', noteText: 'Line 1\nLine 2' }
      })
    ).toEqual([
      { key: 'Added by', value: 'Alice Anderson' },
      { key: 'Note', value: 'Line 1\nLine 2', multiline: true }
    ])
  })

  test('returns an empty array for a note-added entry with no body and no actor', () => {
    expect(
      detailRowsForAuditEntry({ action: 'note-added', details: {} })
    ).toEqual([])
    expect(
      detailRowsForAuditEntry({
        action: 'note-added',
        details: { noteText: '' }
      })
    ).toEqual([])
  })

  test('projects task, state, from/to status and actor for a task-status-changed entry', () => {
    expect(
      detailRowsForAuditEntry({
        action: 'task-status-changed',
        createdBy: 'alice-1',
        createdByName: 'Alice Anderson',
        details: {
          taskId: 'check-eligibility',
          taskDisplayName: 'Check eligibility',
          stateId: 'submitted',
          fromStatus: 'NotStarted',
          toStatus: 'InProgress'
        }
      })
    ).toEqual([
      { key: 'Task', value: 'Check eligibility' },
      { key: 'State', value: 'submitted' },
      { key: 'Previous status', value: 'NotStarted' },
      { key: 'New status', value: 'InProgress' },
      { key: 'Changed by', value: 'Alice Anderson' }
    ])
  })

  test('falls back to task id when display name is missing for task-status-changed', () => {
    expect(
      detailRowsForAuditEntry({
        action: 'task-status-changed',
        details: {
          taskId: 'check-eligibility',
          toStatus: 'Completed'
        }
      })
    ).toEqual([
      { key: 'Task', value: 'check-eligibility' },
      { key: 'New status', value: 'Completed' }
    ])
  })

  test('projects previous assignee, new assignee and the actor for an assigned entry', () => {
    expect(
      detailRowsForAuditEntry({
        action: 'assigned',
        createdBy: 'carol-1',
        createdByName: 'Carol Caseworker',
        details: {
          assigneeId: 'bob-2',
          assigneeName: 'Bob Bobbinson',
          previousAssigneeId: 'alice-1',
          previousAssigneeName: 'Alice Anderson'
        }
      })
    ).toEqual([
      { key: 'Previously assigned to', value: 'Alice Anderson' },
      { key: 'Now assigned to', value: 'Bob Bobbinson' },
      { key: 'Assigned by', value: 'Carol Caseworker' }
    ])
  })

  test('shows "Nobody" as the previous assignee when a work item is assigned for the first time', () => {
    expect(
      detailRowsForAuditEntry({
        action: 'assigned',
        createdBy: 'carol-1',
        createdByName: 'Carol Caseworker',
        details: {
          assigneeId: 'bob-2',
          assigneeName: 'Bob Bobbinson'
        }
      })
    ).toEqual([
      { key: 'Previously assigned to', value: 'Nobody' },
      { key: 'Now assigned to', value: 'Bob Bobbinson' },
      { key: 'Assigned by', value: 'Carol Caseworker' }
    ])
  })

  test('falls back to ids when names are missing on an assigned entry', () => {
    expect(
      detailRowsForAuditEntry({
        action: 'assigned',
        createdBy: 'carol-1',
        details: {
          assigneeId: 'bob-2',
          previousAssigneeId: 'alice-1'
        }
      })
    ).toEqual([
      { key: 'Previously assigned to', value: 'alice-1' },
      { key: 'Now assigned to', value: 'bob-2' },
      { key: 'Assigned by', value: 'carol-1' }
    ])
  })

  test('projects previous assignee and the actor for an unassigned entry', () => {
    expect(
      detailRowsForAuditEntry({
        action: 'unassigned',
        createdBy: 'carol-1',
        createdByName: 'Carol Caseworker',
        details: {
          previousAssigneeId: 'alice-1',
          previousAssigneeName: 'Alice Anderson'
        }
      })
    ).toEqual([
      { key: 'Previously assigned to', value: 'Alice Anderson' },
      { key: 'Unassigned by', value: 'Carol Caseworker' }
    ])
  })
})
