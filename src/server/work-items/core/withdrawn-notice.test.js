import {
  buildWithdrawnNotice,
  WITHDRAWN_NOTICE_TAIL,
  WITHDRAWN_NOTICE_TITLE,
  WITHDRAWN_STATE_ID,
  WITHDRAWN_SUBJECT_WITH_REFERENCE,
  WITHDRAWN_SUBJECT_WITHOUT_REFERENCE
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
      subject: WITHDRAWN_SUBJECT_WITH_REFERENCE,
      applicationRef: 'AP000000001',
      tail: WITHDRAWN_NOTICE_TAIL
    })
    // RA-249: the Guid must never reach the copy.
    expect(Object.values(notice).join(' ')).not.toContain(GUID)
  })

  test('falls back to the raw backend payload reference', () => {
    const notice = buildWithdrawnNotice({
      id: GUID,
      stateId: 'withdrawn',
      payload: { applicationReference: 'AP000000002' }
    })

    expect(notice.applicationRef).toBe('AP000000002')
    expect(notice.subject).toBe(WITHDRAWN_SUBJECT_WITH_REFERENCE)
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
        subject: WITHDRAWN_SUBJECT_WITHOUT_REFERENCE,
        applicationRef: null,
        tail: WITHDRAWN_NOTICE_TAIL
      })
      expect(Object.values(notice).join(' ')).not.toContain(GUID)
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

  // Both variants must read as the same sentence bar the reference, which is
  // the whole reason the prose lives in constants rather than being retyped
  // in the template.
  test('both variants share one tail, so the copy cannot drift', () => {
    const withRef = buildWithdrawnNotice({
      stateId: 'withdrawn',
      applicationRef: 'AP000000008'
    })
    const withoutRef = buildWithdrawnNotice({ stateId: 'withdrawn' })

    expect(withRef.tail).toBe(withoutRef.tail)
    expect(withRef.title).toBe(withoutRef.title)
    expect(`${withoutRef.subject} ${withoutRef.tail}`).toBe(
      'This application has been withdrawn. It can no longer be progressed and no further action is needed.'
    )
    expect(`${withRef.subject} ${withRef.applicationRef} ${withRef.tail}`).toBe(
      'Application AP000000008 has been withdrawn. It can no longer be progressed and no further action is needed.'
    )
  })

  // The reference format is the backend's to decide (it has already changed
  // once, RA-318), so this module deliberately does NOT pattern-match it.
  // Safety therefore rests entirely on the template autoescaping the value —
  // see the render-level regression test in detail.controller.test.js.
  test('passes an unusual reference through untouched — escaping is the template’s job', () => {
    const notice = buildWithdrawnNotice({
      stateId: 'withdrawn',
      applicationRef: '<script>alert(1)</script>'
    })

    expect(notice.applicationRef).toBe('<script>alert(1)</script>')
  })
})
