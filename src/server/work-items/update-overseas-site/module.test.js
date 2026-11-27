import { vi } from 'vitest'

import { assertValidWorkItemModule } from '../core/module.js'
import {
  assertCurrentTemplateVersionIsRegistered,
  clearDetailTemplateRegistry,
  resolveDetailTemplate
} from '../core/templates.js'
import { standardWorkflow } from '../core/standard-workflow.js'
import { requestTypeLabel } from '../core/request-type-label.js'
import { updateOverseasSiteModule, updateOverseasSiteType } from './module.js'

describe('update-overseas-site module (RA-681)', () => {
  afterEach(() => {
    clearDetailTemplateRegistry()
  })

  test('declares the ORS update case type configuration', () => {
    expect(updateOverseasSiteType).toMatchObject({
      id: 'update-overseas-site',
      displayName: 'ORS update',
      category: 'in-year-change',
      templateVersion: 'v1',
      caseTabs: ['application-summary', 'application-history'],
      cardAlwaysShowsSubmittedOn: true
    })
    expect(updateOverseasSiteType.states).toBe(standardWorkflow.states)
    expect(updateOverseasSiteType.transitions).toBe(
      standardWorkflow.transitions
    )
    // The lifecycle actions are the full update view's (next Case Management service ticket).
    expect(updateOverseasSiteType.standardLifecycle).toBeUndefined()
  })

  test.each([
    [true, 'Accreditation: ORS update'],
    [false, 'Registration: ORS update'],
    [undefined, 'ORS update'],
    [null, 'ORS update'],
    ['true', 'ORS update']
  ])('labels a site with selected %s "%s"', (selected, label) => {
    expect(
      requestTypeLabel(updateOverseasSiteType, { site: { selected } })
    ).toBe(label)
  })

  test('labels an item with no site by its display name', () => {
    expect(requestTypeLabel(updateOverseasSiteType, {})).toBe('ORS update')
    expect(requestTypeLabel(updateOverseasSiteType, undefined)).toBe(
      'ORS update'
    )
  })

  test('describes the card site as the site name and its ORS id', () => {
    expect(
      updateOverseasSiteType.describeCardSite({
        site: { siteName: 'Denmark PR', orsId: '007' }
      })
    ).toEqual({ name: 'Denmark PR', reference: '007' })
    expect(updateOverseasSiteType.describeCardSite({})).toEqual({
      name: null,
      reference: null
    })
  })

  test('is a valid module that registers its detail template and no routes', async () => {
    expect(() =>
      assertValidWorkItemModule(updateOverseasSiteModule)
    ).not.toThrow()
    const server = { route: vi.fn() }

    await updateOverseasSiteModule.register(server)

    expect(resolveDetailTemplate('update-overseas-site', 'v1')).toBe(
      'update-overseas-site/detail-v1'
    )
    expect(() =>
      assertCurrentTemplateVersionIsRegistered(
        updateOverseasSiteType.id,
        updateOverseasSiteType.templateVersion
      )
    ).not.toThrow()
    expect(server.route).not.toHaveBeenCalled()
  })
})
