import { vi } from 'vitest'

import { assertValidWorkItemModule } from '../core/module.js'
import {
  assertCurrentTemplateVersionIsRegistered,
  clearDetailTemplateRegistry,
  resolveDetailTemplate
} from '../core/templates.js'
import { standardWorkflow } from '../core/standard-workflow.js'
import { workItemModules } from '../modules.js'
import { updateOverseasSiteModule, updateOverseasSiteType } from './module.js'

describe('update-overseas-site module (RA-767 / RA-782)', () => {
  afterEach(() => {
    clearDetailTemplateRegistry()
  })

  test('declares the ORS update case type configuration', () => {
    expect(updateOverseasSiteType).toMatchObject({
      id: 'update-overseas-site',
      displayName: 'Update ORS Accreditation',
      category: 'in-year-change',
      templateVersion: 'v1',
      cardAlwaysShowsSubmittedOn: true
    })
    expect(updateOverseasSiteType.initialState).toBe(
      standardWorkflow.initialState
    )
    expect(updateOverseasSiteType.states).toBe(standardWorkflow.states)
    expect(updateOverseasSiteType.transitions).toBe(
      standardWorkflow.transitions
    )
  })

  test('is wired into the application', () => {
    expect(workItemModules).toContain(updateOverseasSiteModule)
  })

  test('has the add-ORS tabs', () => {
    expect(updateOverseasSiteType.caseTabs).toEqual([
      'application-summary',
      'accreditation-summary',
      'related-requests',
      'application-history'
    ])
  })

  test('always has an accreditation: an update is to an accredited ORS', () => {
    const { hasAccreditation } = updateOverseasSiteType
    expect(hasAccreditation({ accreditationReference: 'A26' })).toBe(true)
    expect(hasAccreditation(undefined)).toBe(true)
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

  test('is a valid module that registers its detail template and its Standard-lifecycle pages', async () => {
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
    const routes = server.route.mock.calls.flatMap(([mounted]) => mounted)
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /work-items/update-overseas-site/{id}/duly-make',
      'POST /work-items/update-overseas-site/{id}/duly-make',
      'GET /work-items/update-overseas-site/{id}/decision',
      'POST /work-items/update-overseas-site/{id}/decision',
      'GET /work-items/update-overseas-site/{id}/confirm-contact',
      'POST /work-items/update-overseas-site/{id}/confirm-contact',
      'GET /work-items/update-overseas-site/{id}/change-valid-from',
      'POST /work-items/update-overseas-site/{id}/change-valid-from'
    ])
  })

  // RA-782 AC4: never charged, so no payment date and no valid from date.
  test('opts into the Standard lifecycle with no payment date and no valid from date', () => {
    const { standardLifecycle } = updateOverseasSiteType
    expect(standardLifecycle.readPaymentDetails).toBeUndefined()
    expect(standardLifecycle.relatedWorkItems).toBe(true)
    expect(standardLifecycle.effectiveDate).toBe(false)
    expect(standardLifecycle.paymentDate).toBe(false)
    expect(standardLifecycle.backend).toBeUndefined()
  })

  test('supplies its own confirm-contact success banners', () => {
    expect(
      updateOverseasSiteType.standardLifecycle.contactConfirmedBanners
    ).toEqual({
      approved: {
        title: 'Applicant contacted',
        text: "The applicant has been contacted and the overseas reprocessing site's details have been updated on their accreditation."
      },
      rejected: {
        title: 'Applicant contacted',
        text: "The applicant has been contacted and the overseas reprocessing site's details stay as they were."
      }
    })
  })
})
