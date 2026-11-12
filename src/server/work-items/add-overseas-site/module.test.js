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

  test('is a valid module that registers its detail template', async () => {
    expect(() => assertValidWorkItemModule(addOverseasSiteModule)).not.toThrow()

    await addOverseasSiteModule.register({})

    expect(resolveDetailTemplate('add-overseas-site', 'v1')).toBe(
      'add-overseas-site/detail-v1'
    )
  })
})
