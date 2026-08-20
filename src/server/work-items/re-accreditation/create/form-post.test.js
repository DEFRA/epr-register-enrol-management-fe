import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi
} from 'vitest'

import { createServer } from '#/server/server.js'
import { config } from '#/config/config.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { injectWithCrumb } from '#/test-helpers/csrf.js'

/**
 * RA-316. INTEGRATION-LEVEL cover for the create form's outbound payload.
 *
 * This file exists because of a real defect that every other layer of
 * testing missed. `chargeAmountPence` was added to the Joi schema and to
 * the template, both correct in isolation and both covered by passing
 * unit tests — but `reshapeFormPayload` is an ALLOW-LIST, and the field
 * was not in it. The value was therefore dropped before Joi ever saw it.
 * The schema tests passed because they called the schema directly with a
 * value the form never actually delivered.
 *
 * So these tests deliberately do the two things the unit tests could not:
 *  - drive a REAL urlencoded form POST through `server.inject`, with the
 *    value as a STRING exactly as a browser sends it;
 *  - assert on the OUTBOUND request body handed to the backend client,
 *    not on the view model or the schema's return value.
 *
 * That is the only vantage point from which "the form renders it, the
 * schema accepts it, and it still never reaches the backend" is visible.
 */

vi.mock('#/server/common/helpers/backend-api/backend-api.js', async () => {
  const actual = await vi.importActual(
    '#/server/common/helpers/backend-api/backend-api.js'
  )
  return {
    ...actual,
    createWorkItem: vi.fn(),
    getWorkItem: vi.fn(),
    getWorkItems: vi.fn()
  }
})

const { createWorkItem } =
  await import('#/server/common/helpers/backend-api/backend-api.js')

const CREATE_HREF = '/work-items/re-accreditation/new'
const NEW_ID = '55555555-5555-5555-5555-555555555555'

const urlencoded = { 'content-type': 'application/x-www-form-urlencoded' }

/** The flat field names the template actually posts. */
function form(overrides = {}) {
  const fields = {
    operatorEmail: 'test@defra.gov.uk',
    organisationName: 'Acme Recycling Ltd',
    operatorOrganisationId: '500001',
    operatorRegistrationId: 'reg-001',
    siteAddressLine1: '12 Industrial Way',
    siteAddressLine2: '',
    siteAddressTown: 'Bristol',
    siteAddressPostcode: 'BS1 4DJ',
    material: 'plastic',
    tonnageBand: '500-5000',
    ...overrides
  }
  return Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
}

/** The payload actually sent to the backend on the last create call. */
function sentPayload() {
  return createWorkItem.mock.calls[0]?.[0]?.payload
}

let server
let originalFlag

beforeAll(async () => {
  originalFlag = config.get('featureFlags.workItemCreationEnabled')
  // The create routes are feature-flagged and not mounted when off.
  config.set('featureFlags.workItemCreationEnabled', true)
  server = await createServer()
  await server.initialize()
})

afterAll(async () => {
  await server.stop({ timeout: 0 })
  config.set('featureFlags.workItemCreationEnabled', originalFlag)
})

beforeEach(() => {
  vi.clearAllMocks()
  createWorkItem.mockResolvedValue({
    ok: true,
    workItem: {
      id: NEW_ID,
      payload: { applicationReference: 'RA-2026-00004' }
    }
  })
})

async function submit(body) {
  return injectWithCrumb(server, {
    method: 'POST',
    url: CREATE_HREF,
    payload: body,
    headers: urlencoded
  })
}

describe('the create form POST', () => {
  test('forwards a browser-posted charge STRING as an integer', async () => {
    // The exact shape the journey suite sends: a text input carrying
    // "54600". This is the assertion that would have caught the
    // allow-list defect.
    const { statusCode } = await submit(form({ chargeAmountPence: '54600' }))

    expect(statusCode).toBe(statusCodes.redirect)
    expect(createWorkItem).toHaveBeenCalledTimes(1)
    expect(sentPayload()).toHaveProperty('chargeAmountPence', 54600)
    expect(typeof sentPayload().chargeAmountPence).toBe('number')
  })

  test.each([54600, 218400, 327600, 396500, 360400])(
    'forwards the real band value %i posted as a string',
    async (pence) => {
      await submit(form({ chargeAmountPence: String(pence) }))
      expect(sentPayload().chargeAmountPence).toBe(pence)
    }
  )

  test('forwards a zero charge as a real amount', async () => {
    await submit(form({ chargeAmountPence: '0' }))
    expect(sentPayload()).toHaveProperty('chargeAmountPence', 0)
  })

  test('an EMPTY charge box does not block creation', async () => {
    // Empty is the normal case — an item created through this form
    // usually has no charge. `''` must be read as "not supplied" rather
    // than failing `Joi.number()` and rejecting the whole form.
    const { statusCode } = await submit(form({ chargeAmountPence: '' }))

    expect(statusCode).toBe(statusCodes.redirect)
    expect(createWorkItem).toHaveBeenCalledTimes(1)
    expect(sentPayload()).not.toHaveProperty('chargeAmountPence')
  })

  test('omitting the field entirely still creates the work item', async () => {
    const { statusCode } = await submit(form())
    expect(statusCode).toBe(statusCodes.redirect)
    expect(sentPayload()).not.toHaveProperty('chargeAmountPence')
  })

  test('rejects a non-numeric charge without calling the backend', async () => {
    const { statusCode, result } = await submit(
      form({ chargeAmountPence: 'not-a-number' })
    )
    expect(statusCode).toBe(statusCodes.badRequest)
    expect(createWorkItem).not.toHaveBeenCalled()
    expect(result).toContain('govuk-error-summary')
  })

  test('re-renders the typed charge after a validation error elsewhere', async () => {
    // A charge the user typed must survive an unrelated field error,
    // rather than being silently emptied by the re-render.
    const { statusCode, result } = await submit(
      form({ organisationName: '', chargeAmountPence: '54600' })
    )
    expect(statusCode).toBe(statusCodes.badRequest)
    expect(result).toContain('value="54600"')
  })

  test('forwards operatorOrganisationId and operatorRegistrationId to the backend', async () => {
    await submit(
      form({
        operatorOrganisationId: '654321',
        operatorRegistrationId: 'reg-999'
      })
    )
    expect(sentPayload()).toMatchObject({
      operatorOrganisationId: '654321',
      operatorRegistrationId: 'reg-999'
    })
  })

  test('rejects a non-6-digit operatorOrganisationId without calling the backend', async () => {
    const { statusCode, result } = await submit(
      form({ operatorOrganisationId: '123' })
    )
    expect(statusCode).toBe(statusCodes.badRequest)
    expect(createWorkItem).not.toHaveBeenCalled()
    expect(result).toContain('Organisation ID must be 6 digits')
  })

  test('still forwards the other fields unchanged', async () => {
    // Guards the allow-list itself: a careless edit to
    // `reshapeFormPayload` must not drop an existing field while adding
    // the new one.
    await submit(form({ chargeAmountPence: '54600' }))
    expect(sentPayload()).toMatchObject({
      operatorEmail: 'test@defra.gov.uk',
      organisationName: 'Acme Recycling Ltd',
      operatorOrganisationId: '500001',
      operatorRegistrationId: 'reg-001',
      siteAddress: {
        line1: '12 Industrial Way',
        town: 'Bristol',
        postcode: 'BS1 4DJ'
      },
      material: 'plastic',
      tonnageBand: '500-5000'
    })
  })
})
