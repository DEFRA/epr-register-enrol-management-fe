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

const BREADCRUMBS = [
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
        operatorEmail: values.operatorEmail ?? '',
        organisationName: values.organisationName ?? '',
        operatorOrganisationId: values.operatorOrganisationId ?? '',
        operatorRegistrationId: values.operatorRegistrationId ?? '',
        siteAddress: {
          line1: site.line1 ?? '',
          line2: site.line2 ?? '',
          town: site.town ?? '',
          postcode: site.postcode ?? ''
        },
        material: values.material ?? '',
        tonnageBand: values.tonnageBand ?? '',
        // RA-316 passthrough. Echoed back on re-render so a validation
        // error elsewhere on the form does not silently discard it.
        chargeAmountPence: values.chargeAmountPence ?? ''
      },
      fieldErrors,
      errorSummary,
      materialOptions: buildOptions(values.material, MATERIAL_OPTIONS),
      tonnageBandOptions: buildOptions(values.tonnageBand, TONNAGE_BAND_OPTIONS)
    })
    .code(statusCode)
}

const FIELD_ORDER = [
  'operatorEmail',
  'organisationName',
  'operatorOrganisationId',
  'operatorRegistrationId',
  'siteAddress.line1',
  'siteAddress.line2',
  'siteAddress.town',
  'siteAddress.postcode',
  'material',
  'tonnageBand',
  // RA-316 passthrough fields, last so they do not reorder the existing
  // error summary.
  'chargeAmountPence',
  'paymentReference'
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
 * RA-219: the application reference is no longer generated here. The
 * backend stamps it server-side on submission and returns it on the
 * created work item; the user never supplies it. `operatorEmail` is
 * seeded with the default operator address and can be overridden by the
 * caller in tests via `defaultEmail` injection.
 */
const DEMO_VALUES = {
  organisationName: 'Acme Recycling Ltd',
  // RA-448: arbitrary but realistic 6-digit demo Org ID. A caseworker
  // creating a real item overrides it with the operator's actual Org ID.
  operatorOrganisationId: '500001',
  operatorRegistrationId: 'reg-demo-001',
  siteAddress: {
    line1: '12 Industrial Way',
    line2: 'Parkside Estate',
    town: 'Bristol',
    postcode: 'BS1 4DJ'
  },
  material: 'plastic',
  tonnageBand: '500-5000'
  // RA-316. `chargeAmountPence` is deliberately NOT prefilled here, and
  // adding a figure would be a regression rather than a convenience.
  //
  // Any constant put here would be a fee amount hardcoded into a third
  // repo, while epr-s8k0 is open to collapse the two that already exist
  // (the legacy frontend's `paymentDetails.js` and the legacy backend's
  // `AccreditationChargeCalculator`). It would also contradict the reason
  // we refused a server-side default: an item created through this
  // five-field form genuinely HAS no charge to populate from, so "Not
  // provided" on the duly-making page is the system telling the truth,
  // not a gap to be filled. Inventing a figure to make a demo screen look
  // populated is the same mistake in miniature.
  //
  // The value is supplied by whoever creates the item — mgmt-tests passes
  // a different real band value per spec, which is what keeps a
  // pence/pounds slip visible.
}

export function makeCreateWorkItemController({
  defaultEmail = DEFAULT_EMAIL
} = {}) {
  return {
    handler(_request, h) {
      return renderForm(h, {
        values: {
          ...DEMO_VALUES,
          operatorEmail: defaultEmail
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
 *
 * ⚠ THIS FUNCTION IS AN ALLOW-LIST, and that is the trap. A field absent
 * from here is dropped BEFORE Joi ever sees it, so adding one to the
 * schema and the template is not enough: that pair validates and renders
 * perfectly while the value never leaves the browser, and every
 * unit test still passes because they call the schema directly with a
 * value this function never delivered. RA-316 shipped exactly that bug
 * and only a real form POST caught it.
 *
 * ANY NEW FORM FIELD MUST BE ADDED IN THREE PLACES: the template, the
 * schema, and here — with an integration test in `form-post.test.js`
 * asserting the OUTBOUND payload, not the view model.
 */
function reshapeFormPayload(payload) {
  const p = payload ?? {}
  const shaped = {
    operatorEmail: p.operatorEmail,
    organisationName: p.organisationName,
    operatorOrganisationId: p.operatorOrganisationId,
    operatorRegistrationId: p.operatorRegistrationId,
    siteAddress: {
      line1: p.siteAddressLine1,
      line2: p.siteAddressLine2,
      town: p.siteAddressTown,
      postcode: p.siteAddressPostcode
    },
    material: p.material,
    tonnageBand: p.tonnageBand
  }

  // An empty box posts `''`, which `Joi.number()` would reject. Empty is
  // the NORMAL case for this optional field, so "not supplied" must mean
  // the key is ABSENT rather than present-and-undefined — the latter
  // survives Joi and reaches the backend client, where only
  // `JSON.stringify` dropping it saves us. Omitting it outright is what
  // the contract actually means.
  //
  // `0` is a real amount and must survive, hence the explicit `''` test
  // rather than a falsy check.
  if (p.chargeAmountPence !== '' && p.chargeAmountPence != null) {
    shaped.chargeAmountPence = p.chargeAmountPence
  }

  return shaped
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
        // RA-219: the backend stamps the application reference and returns it
        // on the created work item; in practice it is always present. Only
        // flash the success banner when we actually have a reference to show,
        // so a missing reference never produces a dangling "Work item
        // created — " banner.
        // RA-249: the banner is LABELLED "Reference", so it must show the
        // human RA-* reference or nothing — never the work-item Guid. Do NOT
        // fall back to the work-item id here.
        const reference = result.applicationReference ?? null
        if (reference) {
          request.yar.flash('successBanner', { reference })
        }
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
