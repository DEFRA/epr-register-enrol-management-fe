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

  test('passes the supplied payload through to detail rows for a work-item-submitted entry', () => {
    const decorated = decorateAuditLog(
      [
        {
          id: '1',
          action: 'work-item-submitted',
          actionDisplayName: 'Work item submitted',
          details: { typeId: 're-accreditation', stateId: 'submitted' },
          createdAt: '2026-04-27T08:00:00Z'
        }
      ],
      { payload: { applicantName: 'Acme' } }
    )
    expect(decorated[0].detailRows).toEqual([
      { key: 'Type', value: 're-accreditation' },
      { key: 'Initial state', value: 'submitted' },
      {
        key: 'Payload',
        value: JSON.stringify({ applicantName: 'Acme' }, null, 2),
        multiline: true
      }
    ])
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

  test('projects type, initial state, submitter and payload for a work-item-submitted entry', () => {
    expect(
      detailRowsForAuditEntry(
        {
          action: 'work-item-submitted',
          createdBy: 'frontend',
          createdByName: 'Acme submission',
          details: {
            typeId: 're-accreditation',
            stateId: 'submitted',
            templateVersion: 'v1'
          }
        },
        { payload: { applicantName: 'Acme' } }
      )
    ).toEqual([
      { key: 'Type', value: 're-accreditation' },
      { key: 'Initial state', value: 'submitted' },
      { key: 'Submitted by', value: 'Acme submission' },
      {
        key: 'Payload',
        value: JSON.stringify({ applicantName: 'Acme' }, null, 2),
        multiline: true
      }
    ])
  })

  test('omits the payload row when no payload is supplied or it is empty', () => {
    expect(
      detailRowsForAuditEntry({
        action: 'work-item-submitted',
        createdByName: 'Acme submission',
        details: { typeId: 're-accreditation', stateId: 'submitted' }
      })
    ).toEqual([
      { key: 'Type', value: 're-accreditation' },
      { key: 'Initial state', value: 'submitted' },
      { key: 'Submitted by', value: 'Acme submission' }
    ])
    expect(
      detailRowsForAuditEntry(
        {
          action: 'work-item-submitted',
          details: { typeId: 're-accreditation' }
        },
        { payload: null }
      )
    ).toEqual([{ key: 'Type', value: 're-accreditation' }])
    expect(
      detailRowsForAuditEntry(
        {
          action: 'work-item-submitted',
          details: { typeId: 're-accreditation' }
        },
        { payload: '   ' }
      )
    ).toEqual([{ key: 'Type', value: 're-accreditation' }])
  })

  test('renders a string payload verbatim on a work-item-submitted entry', () => {
    expect(
      detailRowsForAuditEntry(
        {
          action: 'work-item-submitted',
          details: { typeId: 're-accreditation' }
        },
        { payload: 'raw-body' }
      )
    ).toEqual([
      { key: 'Type', value: 're-accreditation' },
      { key: 'Payload', value: 'raw-body', multiline: true }
    ])
  })

  test('returns an empty array when JSON.stringify throws on a circular payload', () => {
    const circular = {}
    circular.self = circular
    expect(
      detailRowsForAuditEntry(
        {
          action: 'work-item-submitted',
          details: {}
        },
        { payload: circular }
      )
    ).toEqual([])
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

describe('task-note-added (RA-129)', () => {
  test('summariseAuditEntry shows task and quoted excerpt when both present', () => {
    expect(
      summariseAuditEntry({
        action: 'task-note-added',
        details: {
          taskId: 'check-eligibility',
          taskDisplayName: 'Check eligibility',
          excerpt: 'looks good'
        }
      })
    ).toBe('Check eligibility \u2014 \u201clooks good\u201d')
  })

  test('summariseAuditEntry falls back to taskId when no display name', () => {
    expect(
      summariseAuditEntry({
        action: 'task-note-added',
        details: { taskId: 'check-eligibility', excerpt: '  ' }
      })
    ).toBe('check-eligibility')
  })

  test('summariseAuditEntry returns just the quoted excerpt when no task', () => {
    expect(
      summariseAuditEntry({
        action: 'task-note-added',
        details: { excerpt: 'orphan' }
      })
    ).toBe('\u201corphan\u201d')
  })

  test('summariseAuditEntry returns empty string when neither task nor excerpt', () => {
    expect(
      summariseAuditEntry({ action: 'task-note-added', details: {} })
    ).toBe('')
  })

  test('detailRowsForAuditEntry projects task, actor and multiline excerpt', () => {
    expect(
      detailRowsForAuditEntry({
        action: 'task-note-added',
        createdBy: 'bob-1',
        createdByName: 'Bob Builder',
        details: {
          taskId: 'check-eligibility',
          taskDisplayName: 'Check eligibility',
          excerpt: 'looks good\nmore detail'
        }
      })
    ).toEqual([
      { key: 'Task', value: 'Check eligibility' },
      { key: 'Added by', value: 'Bob Builder' },
      { key: 'Excerpt', value: 'looks good\nmore detail', multiline: true }
    ])
  })

  test('detailRowsForAuditEntry falls back to id and createdBy when names are missing', () => {
    expect(
      detailRowsForAuditEntry({
        action: 'task-note-added',
        createdBy: 'bob-1',
        details: { taskId: 'check-eligibility', excerpt: 'x' }
      })
    ).toEqual([
      { key: 'Task', value: 'check-eligibility' },
      { key: 'Added by', value: 'bob-1' },
      { key: 'Excerpt', value: 'x', multiline: true }
    ])
  })

  test('detailRowsForAuditEntry returns no rows when details are empty', () => {
    expect(detailRowsForAuditEntry({ action: 'task-note-added' })).toEqual([])
  })
})

describe('decorateAuditLog (RA-129)', () => {
  test('returns empty array when entries is not an array', () => {
    expect(decorateAuditLog(null)).toEqual([])
    expect(decorateAuditLog(undefined)).toEqual([])
    expect(decorateAuditLog('nope')).toEqual([])
  })

  test('uses backend actionDisplayName when present and non-blank', () => {
    const [decorated] = decorateAuditLog([
      {
        action: 'task-note-added',
        actionDisplayName: 'Custom label',
        details: {}
      }
    ])
    expect(decorated.actionDisplayName).toBe('Custom label')
  })

  test('falls back to the lookup when backend actionDisplayName is missing', () => {
    const [decorated] = decorateAuditLog([
      { action: 'task-note-added', details: {} }
    ])
    expect(decorated.actionDisplayName).toBe('Task note added')
  })

  test('falls back to the action id when there is no lookup entry', () => {
    const [decorated] = decorateAuditLog([{ action: 'unknown-action' }])
    expect(decorated.actionDisplayName).toBe('unknown-action')
  })

  test('treats blank backend actionDisplayName as missing', () => {
    const [decorated] = decorateAuditLog([
      { action: 'task-note-added', actionDisplayName: '   ', details: {} }
    ])
    expect(decorated.actionDisplayName).toBe('Task note added')
  })

  test('falls back to empty string when both backend label and action are missing', () => {
    const [decorated] = decorateAuditLog([{ details: {} }])
    expect(decorated.actionDisplayName).toBe('')
  })

  test('handles a null entry within the array gracefully', () => {
    const [decorated] = decorateAuditLog([null])
    expect(decorated.actionDisplayName).toBe('')
    expect(decorated.summary).toBe('')
    expect(decorated.detailRows).toEqual([])
  })
})
