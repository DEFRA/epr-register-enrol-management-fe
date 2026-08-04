import {
  buildWithdrawnNotice,
  WITHDRAWN_NOTICE_TITLE,
  WITHDRAWN_STATE_ID
} from './withdrawn-notice.js'

const GUID = 'ad85d038-95e6-45ae-83ee-558ad7e769a2'

describe('#buildWithdrawnNotice (RA-358)', () => {
  test('exports the canonical withdrawn state id', () => {
    expect(WITHDRAWN_STATE_ID).toBe('withdrawn')
  })

  test.each([
    ['undefined work item', undefined],
    ['null work item', null],
    ['a work item with no state', {}],
    ['a submitted work item', { stateId: 'submitted' }],
    ['an approved work item', { stateId: 'approved' }],
    // Guard against a loose equality / truthiness check creeping in: only
    // the exact state id counts.
    ['a look-alike state id', { stateId: 'Withdrawn' }],
    ['a withdrawing state id', { stateId: 'withdrawn-pending' }]
  ])('returns null for %s', (_label, workItem) => {
    expect(buildWithdrawnNotice(workItem)).toBeNull()
  })

  test('names the case by its decorated application reference', () => {
    const notice = buildWithdrawnNotice({
      id: GUID,
      stateId: 'withdrawn',
      applicationRef: 'AP000000001'
    })

    expect(notice).toEqual({
      title: WITHDRAWN_NOTICE_TITLE,
      text: 'Application AP000000001 has been withdrawn. It can no longer be progressed and no further action is needed.',
      applicationRef: 'AP000000001'
    })
    // RA-249: the Guid must never appear in the copy.
    expect(notice.text).not.toContain(GUID)
  })

  test('falls back to the raw backend payload reference', () => {
    const notice = buildWithdrawnNotice({
      id: GUID,
      stateId: 'withdrawn',
      payload: { applicationReference: 'AP000000002' }
    })

    expect(notice.applicationRef).toBe('AP000000002')
    expect(notice.text).toContain('Application AP000000002 has been withdrawn')
  })

  test('prefers the decorated reference over the payload reference', () => {
    const notice = buildWithdrawnNotice({
      stateId: 'withdrawn',
      applicationRef: 'AP000000003',
      payload: { applicationReference: 'AP000000004' }
    })

    expect(notice.applicationRef).toBe('AP000000003')
  })

  test('trims surrounding whitespace off the reference', () => {
    const notice = buildWithdrawnNotice({
      stateId: 'withdrawn',
      applicationRef: '  AP000000005\n'
    })

    expect(notice.applicationRef).toBe('AP000000005')
    expect(notice.text).toContain('Application AP000000005 has been withdrawn')
  })

  test.each([
    ['null', null],
    ['an empty string', ''],
    ['whitespace only', '   '],
    ['a non-string', 12345]
  ])(
    'degrades to unqualified copy when the reference is %s — never the Guid',
    (_label, applicationRef) => {
      const notice = buildWithdrawnNotice({
        id: GUID,
        stateId: 'withdrawn',
        applicationRef,
        payload: { applicationReference: applicationRef }
      })

      expect(notice).toEqual({
        title: WITHDRAWN_NOTICE_TITLE,
        text: 'This application has been withdrawn. It can no longer be progressed and no further action is needed.',
        applicationRef: null
      })
      expect(notice.text).not.toContain(GUID)
    }
  )

  test('reads the payload reference when the decorated one is blank', () => {
    const notice = buildWithdrawnNotice({
      stateId: 'withdrawn',
      applicationRef: '',
      payload: { applicationReference: 'AP000000006' }
    })

    expect(notice.applicationRef).toBe('AP000000006')
  })

  test('is type-agnostic — any module declaring the withdrawn state gets it', () => {
    const notice = buildWithdrawnNotice({
      typeId: 'some-future-type',
      stateId: WITHDRAWN_STATE_ID,
      applicationRef: 'AP000000007'
    })

    expect(notice?.title).toBe(WITHDRAWN_NOTICE_TITLE)
  })
})
