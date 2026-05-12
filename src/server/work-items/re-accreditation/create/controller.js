import { getUser } from '#/server/common/helpers/auth/get-user.js'

import { MATERIAL_OPTIONS, TONNAGE_BAND_OPTIONS } from './schema.js'
import { createReAccreditationService } from './service.js'

const VIEW_PATH = 're-accreditation/create/index'
const PAGE_TITLE = 'Create a work item'

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
  {
    values = {},
    fieldErrors = {},
    errorSummary = null,
    topLevelError = null,
    statusCode = 200
  } = {}
) {
  const site = values.siteAddress ?? {}
  return h
    .view(VIEW_PATH, {
      pageTitle:
        errorSummary || topLevelError ? `Error: ${PAGE_TITLE}` : PAGE_TITLE,
      heading: PAGE_TITLE,
      breadcrumbs: BREADCRUMBS,
      values: {
        applicationReference: values.applicationReference ?? '',
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
      topLevelError,
      materialOptions: buildOptions(values.material, MATERIAL_OPTIONS),
      tonnageBandOptions: buildOptions(values.tonnageBand, TONNAGE_BAND_OPTIONS)
    })
    .code(statusCode)
}

const FIELD_ORDER = [
  'applicationReference',
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
 */
const DEMO_VALUES = {
  applicationReference: 'RA-2024-00123',
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

export function makeCreateWorkItemController() {
  return {
    handler(_request, h) {
      return renderForm(h, { values: DEMO_VALUES })
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
    organisationName: p.organisationName,
    siteAddress: {
      line1: p.siteAddressLine1,
      line2: p.siteAddressLine2,
      town: p.siteAddressTown,
      postcode: p.siteAddressPostcode
    },
    material: p.material,
    tonnageBand: p.tonnageBand
    // submittedByEmail is injected from the authenticated user in the POST handler
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
      formValues.submittedByEmail = user?.email ?? ''
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
      // per-field errors — surface the message at the top of the form.
      const message = result.message ?? 'Could not create the work item.'
      const statusCode = result.reason === 'invalid' ? 400 : 502
      return renderForm(h, {
        values: formValues,
        topLevelError: message,
        errorSummary: {
          titleText: 'There is a problem',
          items: [{ text: message }]
        },
        statusCode
      })
    }
  }
}
