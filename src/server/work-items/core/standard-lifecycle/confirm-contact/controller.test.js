import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('#/server/common/helpers/backend-api/backend-api.js', () => ({
  getReAccreditationPriorYear: vi.fn(),
  getWorkItem: vi.fn()
}))

vi.mock('#/server/common/helpers/auth/get-user.js', () => ({
  getUser: vi.fn(() => ({ id: 'u-1', name: 'Alice' }))
}))

vi.mock('#/server/common/helpers/logging/logger.js', () => ({
  createLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() })
}))

import { getWorkItem } from '#/server/common/helpers/backend-api/backend-api.js'
import {
  clearWorkItemRegistry,
  registerWorkItemType
} from '#/server/work-items/core/registry.js'
import { addOverseasSiteType } from '#/server/work-items/add-overseas-site/module.js'
import { reAccreditationType } from '#/server/work-items/re-accreditation/module.js'

import { makeSubmitConfirmContactController } from './controller.js'

// RA-495. The success banner's wording comes from the type: re-accreditation
// keeps the default ("accreditation is granted / refused"), add-ORS supplies
// its own. Registers the REAL type declarations, as the plugin does at boot.
beforeEach(() => {
  vi.clearAllMocks()
  clearWorkItemRegistry()
  registerWorkItemType(reAccreditationType)
  registerWorkItemType(addOverseasSiteType)
})

function makeToolkit() {
  const view = vi.fn(() => {
    const response = { code: vi.fn(() => response) }
    return response
  })
  return { view, redirect: vi.fn((path) => ({ redirect: path })) }
}

async function confirmContact(typeId, stateId) {
  getWorkItem.mockResolvedValue({
    ok: true,
    workItem: { id: 'wi-1', typeId, stateId, payload: {} }
  })
  const service = {
    confirmApplicantContact: vi.fn().mockResolvedValue({ ok: true })
  }
  const request = {
    params: { id: 'wi-1' },
    payload: { applicantContacted: 'yes' },
    yar: { flash: vi.fn() }
  }
  const h = makeToolkit()

  await makeSubmitConfirmContactController({ typeId, service }).handler(
    request,
    h
  )

  expect(h.redirect).toHaveBeenCalledWith('/work-items/wi-1')
  return request.yar.flash
}

describe('makeSubmitConfirmContactController success banner', () => {
  test.each([
    [
      're-accreditation',
      'approved-pending-contact',
      'The applicant has been contacted and accreditation is granted.'
    ],
    [
      're-accreditation',
      'rejected-pending-contact',
      'The applicant has been contacted and accreditation is refused.'
    ],
    [
      'add-overseas-site',
      'approved-pending-contact',
      'The applicant has been contacted and the overseas reprocessing site has been added to the accreditation.'
    ],
    [
      'add-overseas-site',
      'rejected-pending-contact',
      'The applicant has been contacted and the overseas reprocessing site has not been added to the accreditation.'
    ]
  ])('%s from %s flashes "%s"', async (typeId, stateId, text) => {
    const flash = await confirmContact(typeId, stateId)

    expect(flash).toHaveBeenCalledTimes(1)
    expect(flash).toHaveBeenCalledWith('flashBanner', {
      type: 'success',
      title: 'Applicant contacted',
      text
    })
  })
})
