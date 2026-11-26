import { vi } from 'vitest'

import { assertValidWorkItemModule } from '../core/module.js'
import {
  assertCurrentTemplateVersionIsRegistered,
  clearDetailTemplateRegistry,
  resolveDetailTemplate
} from '../core/templates.js'
import { standardWorkflow } from '../core/standard-workflow.js'
import { addOverseasSiteModule, addOverseasSiteType } from './module.js'

describe('add-overseas-site module (RA-739)', () => {
  afterEach(() => {
    clearDetailTemplateRegistry()
  })

  test('declares the add-ORS case type configuration', () => {
    expect(addOverseasSiteType).toMatchObject({
      id: 'add-overseas-site',
      displayName: 'New ORS accreditation',
      category: 'in-year-change',
      templateVersion: 'v3'
    })
    expect(addOverseasSiteType.initialState).toEqual({
      id: 'submitted',
      displayName: 'Not started'
    })
  })

  // RA-769. A registration-only change has a registration reference and no
  // accreditation reference, so there is no accreditation to summarise.
  test('has an accreditation unless the change is registration-only', () => {
    const { hasAccreditation } = addOverseasSiteType
    expect(
      hasAccreditation({
        registrationReference: 'R26EX0500190001PL',
        accreditationReference: 'A26EX0500190001PL'
      })
    ).toBe(true)
    expect(
      hasAccreditation({ registrationReference: 'R26EX0500190001PL' })
    ).toBe(false)
    expect(hasAccreditation({})).toBe(true)
    expect(hasAccreditation(undefined)).toBe(true)
  })

  test('follows the Standard workflow', () => {
    expect(addOverseasSiteType.states).toBe(standardWorkflow.states)
    expect(addOverseasSiteType.transitions).toBe(standardWorkflow.transitions)
  })

  // df7.10. The Applications list card asks the type for its site line, so
  // the list never reads add-ORS payload fields itself.
  test('describes the card site as the site name and its ORS id', () => {
    expect(
      addOverseasSiteType.describeCardSite({
        site: { siteName: 'Denmark PR', orsId: '007' }
      })
    ).toEqual({ name: 'Denmark PR', reference: '007' })
  })

  test('describes a card site with missing values as nulls', () => {
    expect(addOverseasSiteType.describeCardSite({ site: {} })).toEqual({
      name: null,
      reference: null
    })
    expect(addOverseasSiteType.describeCardSite({})).toEqual({
      name: null,
      reference: null
    })
  })

  test('is a valid module that registers its detail template and its Standard-lifecycle pages', async () => {
    expect(() => assertValidWorkItemModule(addOverseasSiteModule)).not.toThrow()
    const server = { route: vi.fn() }

    await addOverseasSiteModule.register(server)

    // The current version (what management-be stamps) and every older one
    // render with the add-ORS template, never the generic fallback.
    expect(addOverseasSiteType.templateVersion).toBe('v3')
    for (const version of ['v1', 'v2', 'v3']) {
      expect(resolveDetailTemplate('add-overseas-site', version)).toBe(
        'add-overseas-site/detail-v1'
      )
    }
    expect(() =>
      assertCurrentTemplateVersionIsRegistered(
        addOverseasSiteType.id,
        addOverseasSiteType.templateVersion
      )
    ).not.toThrow()
    // RA-495. Duly make, Make determination and Confirm applicant contact.
    const routes = server.route.mock.calls.flatMap(([mounted]) => mounted)
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /work-items/add-overseas-site/{id}/duly-make',
      'POST /work-items/add-overseas-site/{id}/duly-make',
      'GET /work-items/add-overseas-site/{id}/decision',
      'POST /work-items/add-overseas-site/{id}/decision',
      'GET /work-items/add-overseas-site/{id}/confirm-contact',
      'POST /work-items/add-overseas-site/{id}/confirm-contact',
      // RA-698: the way out of `updated` once the operator has responded.
      'POST /work-items/add-overseas-site/{id}/continue-review'
    ])
  })

  // RA-495. The Duly make page shows the site's own charge and the request's
  // payment reference, and the related change requests.
  test('opts into the Standard lifecycle with the site charge as the payment details', () => {
    const { standardLifecycle } = addOverseasSiteType
    expect(
      standardLifecycle.readPaymentDetails({
        payload: {
          chargePence: 98400,
          paymentReference: 'PR/PK/REP/123001',
          site: { chargePence: 32800 }
        }
      })
    ).toEqual({ chargePence: 32800, paymentReference: 'PR/PK/REP/123001' })
    expect(standardLifecycle.readPaymentDetails({})).toEqual({
      chargePence: undefined,
      paymentReference: undefined
    })
    expect(standardLifecycle.relatedWorkItems).toBe(true)
    expect(standardLifecycle.backend).toBeUndefined()
  })

  // RA-495. An add-ORS grant adds the site to an existing accreditation, so
  // the "Applicant contacted" banner must not say an accreditation is granted.
  test('supplies its own confirm-contact success banners', () => {
    expect(
      addOverseasSiteType.standardLifecycle.contactConfirmedBanners
    ).toEqual({
      approved: {
        title: 'Applicant contacted',
        text: 'The applicant has been contacted and the overseas reprocessing site has been added to their accreditation.'
      },
      rejected: {
        title: 'Applicant contacted',
        text: 'The applicant has been contacted and the overseas reprocessing site has not been added to their accreditation.'
      }
    })
  })
})
