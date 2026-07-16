import { describe, expect, test } from 'vitest'
import {
  decorateAuditLog,
  detailRowsForAuditEntry,
  notificationFailureDetected,
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
        preformatted: true
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
        preformatted: true
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
      { key: 'Payload', value: 'raw-body', preformatted: true }
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

describe('decorateAuditLog — workItemSnapshot rows', () => {
  const baseEntry = {
    id: '1',
    action: 'note-added',
    actionDisplayName: 'Note added',
    details: {},
    createdAt: '2026-05-01T09:00:00Z'
  }

  test('appends snapshot rows to every entry when workItemSnapshot is provided', () => {
    const snapshot = {
      orgId: 'APP-001',
      typeDisplayName: 'Re-accreditation',
      stateDisplayName: 'Submitted',
      submittedAt: '2026-05-01T08:00:00Z',
      submittedBy: 'frontend',
      lastModifiedAt: '2026-05-01T09:00:00Z',
      assignedToName: 'Alice Anderson'
    }
    const [decorated] = decorateAuditLog([baseEntry], {
      workItemSnapshot: snapshot
    })
    const keys = decorated.detailRows.map((r) => r.key)
    expect(keys).toContain('Org ID')
    expect(keys).toContain('Type')
    expect(keys).toContain('State')
    expect(keys).toContain('Submitted at')
    expect(keys).toContain('Submitted by')
    expect(keys).toContain('Last modified')
    expect(keys).toContain('Assigned to')
  })

  test('shows "Unassigned" when assignedToName is null', () => {
    const [decorated] = decorateAuditLog([baseEntry], {
      workItemSnapshot: { assignedToName: null }
    })
    const assignedRow = decorated.detailRows.find(
      (r) => r.key === 'Assigned to'
    )
    expect(assignedRow?.value).toBe('Unassigned')
  })

  test('omits optional snapshot rows when values are absent', () => {
    const [decorated] = decorateAuditLog([baseEntry], {
      workItemSnapshot: { assignedToName: 'Alice' }
    })
    const keys = decorated.detailRows.map((r) => r.key)
    expect(keys).not.toContain('Org ID')
    expect(keys).not.toContain('Submitted at')
    expect(keys).not.toContain('Last modified')
    expect(keys).toContain('Assigned to')
  })

  test('appends snapshot rows after entry-specific rows', () => {
    const [decorated] = decorateAuditLog(
      [
        {
          id: '1',
          action: 'task-completed',
          createdByName: 'Alice',
          details: {
            taskDisplayName: 'Check eligibility',
            stateId: 'submitted'
          }
        }
      ],
      {
        workItemSnapshot: {
          typeDisplayName: 'Re-accreditation',
          assignedToName: null
        }
      }
    )
    const keys = decorated.detailRows.map((r) => r.key)
    expect(keys.indexOf('Task')).toBeLessThan(keys.indexOf('Type'))
  })

  test('returns no snapshot rows when workItemSnapshot is absent', () => {
    const [decorated] = decorateAuditLog([baseEntry])
    expect(decorated.detailRows).toEqual([])
  })

  test('returns no snapshot rows when workItemSnapshot is null', () => {
    const [decorated] = decorateAuditLog([baseEntry], {
      workItemSnapshot: null
    })
    expect(decorated.detailRows).toEqual([])
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
    expect(decorated.isFailure).toBe(false)
  })
})

describe('notification audit entries (RA-234)', () => {
  describe('actionDisplayNameFor fallbacks', () => {
    test('notification-sent falls back to "Notification sent"', () => {
      const [decorated] = decorateAuditLog([
        { action: 'notification-sent', details: {} }
      ])
      expect(decorated.actionDisplayName).toBe('Notification sent')
    })

    test('notification-skipped falls back to "Notification not sent"', () => {
      const [decorated] = decorateAuditLog([
        { action: 'notification-skipped', details: {} }
      ])
      expect(decorated.actionDisplayName).toBe('Notification not sent')
    })

    test('notification-failed falls back to "Notification failed"', () => {
      const [decorated] = decorateAuditLog([
        { action: 'notification-failed', details: {} }
      ])
      expect(decorated.actionDisplayName).toBe('Notification failed')
    })

    test('uses the backend actionDisplayName when present', () => {
      const [decorated] = decorateAuditLog([
        {
          action: 'notification-sent',
          actionDisplayName: 'Submission confirmation email sent',
          details: {}
        }
      ])
      expect(decorated.actionDisplayName).toBe(
        'Submission confirmation email sent'
      )
    })
  })

  describe('summariseAuditEntry', () => {
    test('notification-sent summarises to the recipient', () => {
      expect(
        summariseAuditEntry({
          action: 'notification-sent',
          details: { recipient: 'op@example.com' }
        })
      ).toBe('op@example.com')
    })

    test('notification-sent summary is empty when recipient absent', () => {
      expect(
        summariseAuditEntry({ action: 'notification-sent', details: {} })
      ).toBe('')
    })

    test('notification-skipped summarises to the reason', () => {
      expect(
        summariseAuditEntry({
          action: 'notification-skipped',
          details: { reason: 'missing-operator-email' }
        })
      ).toBe('missing-operator-email')
    })

    test('notification-skipped summary is empty when reason absent', () => {
      expect(
        summariseAuditEntry({ action: 'notification-skipped', details: {} })
      ).toBe('')
    })

    test('notification-failed summarises to the error message', () => {
      expect(
        summariseAuditEntry({
          action: 'notification-failed',
          details: { errorMessage: 'Notify returned 500' }
        })
      ).toBe('Notify returned 500')
    })

    test('notification-failed summary is empty when error message absent', () => {
      expect(
        summariseAuditEntry({ action: 'notification-failed', details: {} })
      ).toBe('')
    })
  })

  describe('detailRowsForAuditEntry', () => {
    test('projects all fields for a notification-sent entry', () => {
      expect(
        detailRowsForAuditEntry({
          action: 'notification-sent',
          createdBy: 'frontend',
          createdByName: 'Carol Caseworker',
          details: {
            templateKey: 'SubmissionConfirmation',
            recipient: 'op@example.com',
            reference: 'wi-1',
            providerMessageId: 'msg-123'
          }
        })
      ).toEqual([
        { key: 'Notification type', value: 'SubmissionConfirmation' },
        { key: 'Recipient', value: 'op@example.com' },
        { key: 'Reference', value: 'wi-1' },
        { key: 'Provider message ID', value: 'msg-123' },
        { key: 'Triggered by', value: 'Carol Caseworker' }
      ])
    })

    test('projects the nation row for a regulator notification-sent entry', () => {
      expect(
        detailRowsForAuditEntry({
          action: 'notification-sent',
          createdByName: 'Carol Caseworker',
          details: {
            templateKey: 'OfficerAssignment',
            recipient: 'packagingnotifications@environment-agency.gov.uk',
            reference: 'wi-3',
            nation: 'England',
            providerMessageId: 'msg-456'
          }
        })
      ).toEqual([
        { key: 'Notification type', value: 'OfficerAssignment' },
        {
          key: 'Recipient',
          value: 'packagingnotifications@environment-agency.gov.uk'
        },
        { key: 'Reference', value: 'wi-3' },
        { key: 'Nation', value: 'England' },
        { key: 'Provider message ID', value: 'msg-456' },
        { key: 'Triggered by', value: 'Carol Caseworker' }
      ])
    })

    test('projects the nation row on a skipped regulator entry alongside the reason', () => {
      // The backend records nation even when it could not resolve a mailbox for
      // it — that pairing is what explains the skip to a caseworker.
      expect(
        detailRowsForAuditEntry({
          action: 'notification-skipped',
          createdByName: 'Carol Caseworker',
          details: {
            templateKey: 'OfficerAssignment',
            reference: 'wi-4',
            nation: 'Scotland',
            reason: 'missing-regulator-mailbox'
          }
        })
      ).toEqual([
        { key: 'Notification type', value: 'OfficerAssignment' },
        { key: 'Reference', value: 'wi-4' },
        { key: 'Nation', value: 'Scotland' },
        { key: 'Reason', value: 'missing-regulator-mailbox' },
        { key: 'Triggered by', value: 'Carol Caseworker' }
      ])
    })

    test('omits the nation row when the work item was never routed', () => {
      // nation is explicitly null on an unrouted item; it must not render as an
      // empty row.
      const rows = detailRowsForAuditEntry({
        action: 'notification-skipped',
        details: {
          templateKey: 'RegulatorSubmission',
          reference: 'wi-5',
          nation: null,
          reason: 'missing-regulator-mailbox'
        }
      })
      expect(rows.map((r) => r.key)).not.toContain('Nation')
    })

    test('projects template, reference and reason for a notification-skipped entry (no recipient)', () => {
      expect(
        detailRowsForAuditEntry({
          action: 'notification-skipped',
          createdByName: 'Carol Caseworker',
          details: {
            templateKey: 'SubmissionConfirmation',
            reference: 'wi-1',
            reason: 'missing-operator-email'
          }
        })
      ).toEqual([
        { key: 'Notification type', value: 'SubmissionConfirmation' },
        { key: 'Reference', value: 'wi-1' },
        { key: 'Reason', value: 'missing-operator-email' },
        { key: 'Triggered by', value: 'Carol Caseworker' }
      ])
    })

    test('projects the error message as a multiline row for a notification-failed entry', () => {
      expect(
        detailRowsForAuditEntry({
          action: 'notification-failed',
          createdBy: 'frontend',
          details: {
            templateKey: 'Decision',
            recipient: 'op@example.com',
            reference: 'wi-2',
            providerMessageId: null,
            errorMessage: 'Notify returned 500\nstatus: ServiceUnavailable'
          }
        })
      ).toEqual([
        { key: 'Notification type', value: 'Decision' },
        { key: 'Recipient', value: 'op@example.com' },
        { key: 'Reference', value: 'wi-2' },
        {
          key: 'Error',
          value: 'Notify returned 500\nstatus: ServiceUnavailable',
          multiline: true
        },
        { key: 'Triggered by', value: 'frontend' }
      ])
    })

    test('returns an empty array for a notification entry with no details and no actor', () => {
      expect(
        detailRowsForAuditEntry({ action: 'notification-sent', details: {} })
      ).toEqual([])
      expect(
        detailRowsForAuditEntry({ action: 'notification-failed' })
      ).toEqual([])
    })
  })

  describe('isFailure flag on decorateAuditLog', () => {
    test('marks notification-failed entries as failures', () => {
      const [decorated] = decorateAuditLog([
        { action: 'notification-failed', details: {} }
      ])
      expect(decorated.isFailure).toBe(true)
    })

    test('does not mark notification-sent or notification-skipped as failures', () => {
      const decorated = decorateAuditLog([
        { action: 'notification-sent', details: {} },
        { action: 'notification-skipped', details: {} }
      ])
      expect(decorated[0].isFailure).toBe(false)
      expect(decorated[1].isFailure).toBe(false)
    })

    test('does not mark ordinary actions as failures', () => {
      const [decorated] = decorateAuditLog([
        { action: 'task-completed', details: {} }
      ])
      expect(decorated.isFailure).toBe(false)
    })
  })
})

describe('notificationFailureDetected', () => {
  test('returns true when a notification-failed entry has no later notification-sent entry', () => {
    const auditLog = [
      {
        action: 'notification-failed',
        createdAt: '2026-04-27T10:00:00Z',
        details: { templateKey: 'Queried' }
      }
    ]
    expect(notificationFailureDetected(auditLog)).toBe(true)
  })

  test('returns false for a clean notification history (no failures)', () => {
    const auditLog = [
      {
        action: 'notification-sent',
        createdAt: '2026-04-27T10:00:00Z',
        details: { templateKey: 'SubmissionConfirmation' }
      },
      { action: 'task-completed', createdAt: '2026-04-27T10:05:00Z' }
    ]
    expect(notificationFailureDetected(auditLog)).toBe(false)
  })

  test('returns false when a later notification-sent entry for the SAME template resolves the failure', () => {
    // e.g. a resend of the same email type later succeeded.
    const auditLog = [
      {
        action: 'notification-failed',
        createdAt: '2026-04-27T10:00:00Z',
        details: { templateKey: 'SubmissionConfirmation' }
      },
      {
        action: 'notification-sent',
        createdAt: '2026-04-27T10:05:00Z',
        details: { templateKey: 'SubmissionConfirmation' }
      }
    ]
    expect(notificationFailureDetected(auditLog)).toBe(false)
  })

  test('returns true when a later notification-sent entry is for a DIFFERENT template (unrelated success does not resolve it)', () => {
    // A DulyMade email succeeding must not hide an unresolved Queried failure.
    const auditLog = [
      {
        action: 'notification-failed',
        createdAt: '2026-04-27T10:00:00Z',
        details: { templateKey: 'Queried' }
      },
      {
        action: 'notification-sent',
        createdAt: '2026-04-27T10:05:00Z',
        details: { templateKey: 'DulyMade' }
      }
    ]
    expect(notificationFailureDetected(auditLog)).toBe(true)
  })

  test('returns false when a later notification-sent entry has no templateKey (degrades to resolving any failure)', () => {
    const auditLog = [
      {
        action: 'notification-failed',
        createdAt: '2026-04-27T10:00:00Z',
        details: { templateKey: 'SubmissionConfirmation' }
      },
      {
        action: 'notification-sent',
        createdAt: '2026-04-27T10:05:00Z',
        details: {}
      }
    ]
    expect(notificationFailureDetected(auditLog)).toBe(false)
  })

  test('returns true when the notification-sent entry precedes the failure (still unresolved)', () => {
    const auditLog = [
      {
        action: 'notification-sent',
        createdAt: '2026-04-27T09:00:00Z',
        details: { templateKey: 'SubmissionConfirmation' }
      },
      {
        action: 'notification-failed',
        createdAt: '2026-04-27T10:00:00Z',
        details: { templateKey: 'Queried' }
      }
    ]
    expect(notificationFailureDetected(auditLog)).toBe(true)
  })

  test('returns false when auditLog is missing or not an array', () => {
    expect(notificationFailureDetected(undefined)).toBe(false)
    expect(notificationFailureDetected(null)).toBe(false)
    expect(notificationFailureDetected('not-an-array')).toBe(false)
  })

  test('returns false for an empty audit log', () => {
    expect(notificationFailureDetected([])).toBe(false)
  })

  // AC: "still retrying" is not a distinct audit state — the backend only
  // writes notification-failed once its own retry pipeline is exhausted.
  // notification-skipped (no operator email) is not a failure either.
  test('ignores notification-skipped entries', () => {
    const auditLog = [
      {
        action: 'notification-skipped',
        createdAt: '2026-04-27T10:00:00Z',
        details: { reason: 'missing-operator-email' }
      }
    ]
    expect(notificationFailureDetected(auditLog)).toBe(false)
  })
})
