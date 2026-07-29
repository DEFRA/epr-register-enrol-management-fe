import { describe, expect, test, vi, beforeEach } from 'vitest'

// The end-to-end render tests below boot the real server, which wires every
// route — so the whole backend-api surface has to be stubbed, not just the
// two functions this controller calls.
vi.mock('#/server/common/helpers/backend-api/backend-api.js', () => ({
  getReAccreditationPriorYear: vi.fn(),
  getWorkItem: vi.fn(),
  getWorkItems: vi.fn(),
  getBackendHealth: vi.fn(),
  assignWorkItem: vi.fn(),
  unassignWorkItem: vi.fn(),
  completeWorkItemTask: vi.fn(),
  setWorkItemTaskStatus: vi.fn(),
  applyWorkItemAction: vi.fn(),
  addWorkItemNote: vi.fn(),
  raiseWorkItemQuery: vi.fn()
}))

vi.mock('#/server/common/helpers/auth/get-user.js', () => ({
  getUser: vi.fn(() => ({ id: 'u-1', name: 'Alice' }))
}))

vi.mock('#/server/work-items/core/assignees.js', () => ({
  getAssignableUsers: vi.fn(() => [
    { id: 'u-1', name: 'Alice' },
    { id: 'u-2', name: 'Bob' },
    { id: 'u-3' }
  ])
}))

import { getWorkItem } from '#/server/common/helpers/backend-api/backend-api.js'

import {
  makeShowAssignController,
  makeShowUnassignController
} from './assign.controller.js'

function buildHapi({ params = {} } = {}) {
  const captured = {}
  const h = {
    view: vi.fn((path, ctx) => {
      captured.viewPath = path
      captured.viewCtx = ctx
      const sealed = { path, ctx }
      sealed.code = (status) => {
        captured.statusCode = status
        return sealed
      }
      return sealed
    })
  }
  const request = {
    params: { id: 'wi 1', ...params },
    auth: { credentials: { scope: [] } }
  }
  return { request, h, captured }
}

function aWorkItem(overrides = {}) {
  return {
    id: 'wi 1',
    payload: { applicationReference: 'RA-2026-00001' },
    assignedToId: 'u-2',
    assignedToName: 'Bob',
    ...overrides
  }
}

describe('#makeShowAssignController (RA-295 AC03)', () => {
  beforeEach(() => {
    getWorkItem.mockReset()
  })

  test('renders the reassign picker with the current assignee pre-selected', async () => {
    getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem() })
    const { request, h, captured } = buildHapi()

    await makeShowAssignController().handler(request, h)

    expect(captured.viewPath).toBe('work-items/assign')
    expect(captured.viewCtx).toMatchObject({
      pageTitle: 'Reassign the application',
      applicationRef: 'RA-2026-00001',
      assignedToName: 'Bob',
      formAction: '/work-items/wi%201/assign',
      cancelHref: '/work-items/wi%201'
    })
    expect(captured.viewCtx.assignableUsers).toEqual([
      { value: 'u-1', text: 'Alice', selected: false },
      { value: 'u-2', text: 'Bob', selected: true },
      // A directory entry with no name falls back to its id.
      { value: 'u-3', text: 'u-3', selected: false }
    ])
    expect(captured.viewCtx.breadcrumbs).toEqual([
      { text: 'Applications', href: '/work-items' },
      { text: 'RA-2026-00001', href: '/work-items/wi%201' },
      { text: 'Reassign' }
    ])
  })

  test('falls back to the assignee id when the name snapshot is missing', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({ assignedToName: null })
    })
    const { request, h, captured } = buildHapi()

    await makeShowAssignController().handler(request, h)

    expect(captured.viewCtx.assignedToName).toBe('u-2')
  })

  test('shows no assignee, and no reference in the breadcrumb, when both are absent', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({
        payload: {},
        assignedToId: null,
        assignedToName: null
      })
    })
    const { request, h, captured } = buildHapi()

    await makeShowAssignController().handler(request, h)

    expect(captured.viewCtx.applicationRef).toBeNull()
    expect(captured.viewCtx.assignedToName).toBeNull()
    expect(captured.viewCtx.breadcrumbs[1].text).toBe('Application')
  })

  test('renders 404 when the work item is missing', async () => {
    getWorkItem.mockResolvedValue({ ok: false, status: 404 })
    const { request, h, captured } = buildHapi()

    await makeShowAssignController().handler(request, h)

    expect(captured.viewPath).toBe('work-items/not-found')
    expect(captured.statusCode).toBe(404)
  })

  test('renders 502 when the backend is unavailable', async () => {
    getWorkItem.mockResolvedValue({ ok: false, status: 503, error: 'boom' })
    const { request, h, captured } = buildHapi()

    await makeShowAssignController().handler(request, h)

    expect(captured.viewPath).toBe('work-items/detail-error')
    expect(captured.statusCode).toBe(502)
    expect(captured.viewCtx.error).toBe('boom')
  })

  test('describes an unexplained backend failure by its status code', async () => {
    getWorkItem.mockResolvedValue({ ok: false, status: 500 })
    const { request, h, captured } = buildHapi()

    await makeShowAssignController().handler(request, h)

    expect(captured.viewCtx.error).toBe('Backend returned 500')
  })
})

describe('#makeShowUnassignController (RA-295 AC03)', () => {
  beforeEach(() => {
    getWorkItem.mockReset()
  })

  test('offers the confirmation when the application is assigned', async () => {
    getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem() })
    const { request, h, captured } = buildHapi()

    await makeShowUnassignController().handler(request, h)

    expect(captured.viewPath).toBe('work-items/unassign')
    expect(captured.viewCtx).toMatchObject({
      isUnassigned: false,
      assignedToName: 'Bob',
      formAction: '/work-items/wi%201/unassign',
      cancelHref: '/work-items/wi%201'
    })
  })

  test('AC03 keeps the link available in every state, so it copes with an already-unassigned item', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      // Also exercises a work item that carries no payload at all.
      workItem: aWorkItem({
        payload: undefined,
        assignedToId: null,
        assignedToName: null
      })
    })
    const { request, h, captured } = buildHapi()

    await makeShowUnassignController().handler(request, h)

    expect(captured.viewCtx.isUnassigned).toBe(true)
    expect(captured.viewCtx.assignedToName).toBeNull()
  })

  test('falls back to the assignee id when the name snapshot is missing', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({ assignedToName: null })
    })
    const { request, h, captured } = buildHapi()

    await makeShowUnassignController().handler(request, h)

    expect(captured.viewCtx.assignedToName).toBe('u-2')
  })

  test('renders 404 when the work item is missing', async () => {
    getWorkItem.mockResolvedValue({ ok: false, status: 404 })
    const { request, h, captured } = buildHapi()

    await makeShowUnassignController().handler(request, h)

    expect(captured.viewPath).toBe('work-items/not-found')
    expect(captured.statusCode).toBe(404)
  })

  test('renders 502 when the backend is unavailable', async () => {
    getWorkItem.mockResolvedValue({ ok: false, status: 503, error: 'boom' })
    const { request, h, captured } = buildHapi()

    await makeShowUnassignController().handler(request, h)

    expect(captured.viewPath).toBe('work-items/detail-error')
    expect(captured.statusCode).toBe(502)
  })
})

// ---------------------------------------------------------------------
// Render tests against the REAL server and the REAL Nunjucks templates.
//
// The unit tests above drive the handlers with a fake `h`, which proves the
// view model but would happily ship a Nunjucks syntax error, a wrong view
// path or a missing `crumb`. These mount the actual routes so the templates
// are compiled and rendered for real.
// ---------------------------------------------------------------------
describe('RA-295 AC03 interstitials render end-to-end', () => {
  let server

  beforeAll(async () => {
    const { createServer } = await import('#/server/server.js')
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  beforeEach(() => {
    getWorkItem.mockReset()
  })

  test('GET /assign renders the picker, the CSRF crumb and a cancel link', async () => {
    getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem() })

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/work-items/wi%201/assign'
    })

    expect(statusCode).toBe(200)
    expect(result).toContain('data-testid="assign-form"')
    expect(result).toContain('data-testid="assign-select"')
    expect(result).toContain('data-testid="assign-submit"')
    expect(result).toContain('data-testid="assign-cancel"')
    expect(result).toContain('Currently assigned to Bob')
    expect(result).toContain('action="/work-items/wi%201/assign"')
    // Without a crumb the POST would be rejected as a CSRF failure.
    expect(result).toMatch(/name="crumb" value="[^"]+"/)
  })

  test('GET /assign copes with an unassigned work item', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({ assignedToId: null, assignedToName: null })
    })

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/work-items/wi%201/assign'
    })

    expect(statusCode).toBe(200)
    expect(result).toContain('not currently assigned to anyone')
  })

  test('GET /unassign renders the confirmation with a crumb', async () => {
    getWorkItem.mockResolvedValue({ ok: true, workItem: aWorkItem() })

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/work-items/wi%201/unassign'
    })

    expect(statusCode).toBe(200)
    expect(result).toContain('data-testid="unassign-form"')
    expect(result).toContain('data-testid="unassign-submit"')
    expect(result).toContain('data-testid="unassign-current"')
    expect(result).toContain('currently assigned to Bob')
    expect(result).toContain('action="/work-items/wi%201/unassign"')
    expect(result).toMatch(/name="crumb" value="[^"]+"/)
  })

  test('GET /unassign explains itself instead of offering a no-op confirm', async () => {
    getWorkItem.mockResolvedValue({
      ok: true,
      workItem: aWorkItem({ assignedToId: null, assignedToName: null })
    })

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/work-items/wi%201/unassign'
    })

    expect(statusCode).toBe(200)
    expect(result).toContain('data-testid="unassign-already-unassigned"')
    expect(result).toContain('nothing to unassign')
    expect(result).not.toContain('data-testid="unassign-submit"')
    expect(result).toContain('data-testid="unassign-cancel"')
  })

  test('both interstitials render the not-found page for a missing work item', async () => {
    getWorkItem.mockResolvedValue({ ok: false, status: 404 })

    for (const path of ['assign', 'unassign']) {
      const { statusCode, result } = await server.inject({
        method: 'GET',
        url: `/work-items/wi%201/${path}`
      })
      expect(statusCode).toBe(404)
      expect(result).toContain('Work item not found')
    }
  })
})
