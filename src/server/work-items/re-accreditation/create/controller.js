import { getUser } from '#/server/common/helpers/auth/get-user.js'

import { MATERIAL_OPTIONS, TONNAGE_BAND_OPTIONS } from './schema.js'
import { createReAccreditationService } from './service.js'

const VIEW_PATH = 're-accreditation/create/index'
const PAGE_TITLE = 'Create a work item'

/**
 * Default email pre-filled into the create form (RA-172). The field is
 * editable; this is just a sensible demo seed so journey tests do not
 * have to type one in every run.
 */
export const DEFAULT_EMAIL = 'test@defra.gov.uk'

/**
 * RA-172: build a fresh, random application reference for each GET of
 * the create form. The field is rendered read-only so the user cannot
 * tweak it — the value still travels back to the backend on POST via a
 * standard input element (read-only inputs are submitted; disabled ones
 * are not, which would defeat the purpose).
 *
 * Format: `RA-<9-digit-number>` — long enough that collisions across a
 * demo session are vanishingly rare, and within the schema's 50-char /
 * `[A-Za-z0-9-]+` constraints.
 */
export function generateApplicationReference() {
  const min = 100_000_000
  const max = 999_999_999
  const n = Math.floor(Math.random() * (max - min + 1)) + min
  return `RA-${n}`
}

const BREADCRUMBS = [
  { text: 'Home', href: '/' },
  { text: 'Work items', href: '/work-items' },
  { text: PAGE_TITLE }
]

function buildOptions(selected, options) {
  return [
    { value: '', text: 'Choose…', selected: !selected },
    ...options.map((o) => ({ ...o, selected: o.value === selected }))
  ]
}

function renderForm(
  h,
  { values = {}, fieldErrors = {}, errorSummary = null, statusCode = 200 } = {}
) {
  const site = values.siteAddress ?? {}
  return h
    .view(VIEW_PATH, {
      pageTitle: errorSummary ? `Error: ${PAGE_TITLE}` : PAGE_TITLE,
      heading: PAGE_TITLE,
      breadcrumbs: BREADCRUMBS,
      values: {
        applicationReference: values.applicationReference ?? '',
        email: values.email ?? '',
        organisationName: values.organisationName ?? '',
        siteAddress: {
          line1: site.line1 ?? '',
          line2: site.line2 ?? '',
          town: site.town ?? '',
          postcode: site.postcode ?? ''
        },
        material: values.material ?? '',
        tonnageBand: values.tonnageBand ?? ''
      },
      fieldErrors,
      errorSummary,
      materialOptions: buildOptions(values.material, MATERIAL_OPTIONS),
      tonnageBandOptions: buildOptions(values.tonnageBand, TONNAGE_BAND_OPTIONS)
    })
    .code(statusCode)
}

const FIELD_ORDER = [
  'applicationReference',
  'email',
  'organisationName',
  'siteAddress.line1',
  'siteAddress.line2',
  'siteAddress.town',
  'siteAddress.postcode',
  'material',
  'tonnageBand'
]

function buildErrorSummary(fieldErrors) {
  const items = []
  for (const field of FIELD_ORDER) {
    if (fieldErrors[field]) {
      items.push({
        text: fieldErrors[field],
        href: `#field-${field.replace(/\./g, '-')}`
      })
    }
  }
  return items.length === 0 ? null : { titleText: 'There is a problem', items }
}

/**
 * GET /work-items/re-accreditation/new — render the create form pre-filled with demo data.
 *
 * RA-172: `applicationReference` is generated per-request (read-only in
 * the template) and `email` is seeded with the default operator address.
 * Both can be overridden by the caller in tests via `generateReference`
 * and `defaultEmail` injection.
 */
const DEMO_VALUES = {
  organisationName: 'Acme Recycling Ltd',
  siteAddress: {
    line1: '12 Industrial Way',
    line2: 'Parkside Estate',
    town: 'Bristol',
    postcode: 'BS1 4DJ'
  },
  material: 'plastic',
  tonnageBand: '500-5000'
}

export function makeCreateWorkItemController({
  generateReference = generateApplicationReference,
  defaultEmail = DEFAULT_EMAIL
} = {}) {
  return {
    handler(_request, h) {
      return renderForm(h, {
        values: {
          ...DEMO_VALUES,
          applicationReference: generateReference(),
          email: defaultEmail
        }
      })
    }
  }
}

/**
 * Reshape a flat form payload (with `siteAddressLine1` etc.) into the
 * nested object the service / Joi schema expects. Keeps the form HTML
 * compatible with Hapi's default `application/x-www-form-urlencoded`
 * parser (which does not understand bracket-notation keys).
 */
function reshapeFormPayload(payload) {
  const p = payload ?? {}
  return {
    applicationReference: p.applicationReference,
    email: p.email,
    organisationName: p.organisationName,
    siteAddress: {
      line1: p.siteAddressLine1,
      line2: p.siteAddressLine2,
      town: p.siteAddressTown,
      postcode: p.siteAddressPostcode
    },
    material: p.material,
    tonnageBand: p.tonnageBand
  }
}

/**
 * POST /work-items/re-accreditation/new — Joi-validate and submit.
 *
 * Service object owns validation + the backend call. On success we flash
 * a single-shot success banner into the yar session and PRG-redirect to
 * the new work item's detail page; the detail controller reads the
 * flash and renders the GOV.UK notification banner.
 */
export function makeSubmitCreateWorkItemController({
  service = createReAccreditationService()
} = {}) {
  return {
    async handler(request, h) {
      const user = getUser(request)
      const formValues = reshapeFormPayload(request.payload)
      const result = await service.create({
        formValues,
        user
      })

      if (result.ok) {
        request.yar.flash('successBanner', {
          reference: result.applicationReference
        })
        return h.redirect(
          `/work-items/${encodeURIComponent(result.workItem.id)}`
        )
      }

      if (result.reason === 'invalid' && result.fieldErrors) {
        return renderForm(h, {
          values: formValues,
          fieldErrors: result.fieldErrors,
          errorSummary: buildErrorSummary(result.fieldErrors),
          statusCode: 400
        })
      }

      // Backend rejection (server/network/auth) or invalid without
      // per-field errors — surface the message via the error summary at
      // the top of the form.
      const message = result.message ?? 'Could not create the work item.'
      const statusCode = result.reason === 'invalid' ? 400 : 502
      return renderForm(h, {
        values: formValues,
        errorSummary: {
          titleText: 'There is a problem',
          items: [{ text: message }]
        },
        statusCode
      })
    }
  }
}
