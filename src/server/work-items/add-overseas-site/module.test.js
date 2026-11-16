import { assertValidWorkItemModule } from '../core/module.js'
import {
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
      templateVersion: 'v1'
    })
    expect(addOverseasSiteType.initialState).toEqual({
      id: 'submitted',
      displayName: 'Not started'
    })
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

  test('is a valid module that registers its detail template', async () => {
    expect(() => assertValidWorkItemModule(addOverseasSiteModule)).not.toThrow()

    await addOverseasSiteModule.register({})

    expect(resolveDetailTemplate('add-overseas-site', 'v1')).toBe(
      'add-overseas-site/detail-v1'
    )
  })
})
