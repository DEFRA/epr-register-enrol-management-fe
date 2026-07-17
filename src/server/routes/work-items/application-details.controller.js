import {
  getReAccreditationPriorYear,
  getWorkItem
} from '#/server/common/helpers/backend-api/backend-api.js'
import {
  formatSiteAddress,
  getSitePostcode
} from '#/server/common/helpers/format/site-address.js'

const RE_ACCREDITATION_TYPE_ID = 're-accreditation'

const TONNAGE_BAND_LABELS = {
  UpTo500: 'Up to 500 tonnes',
  UpTo1000: 'Up to 1,000 tonnes',
  UpTo10000: 'Up to 10,000 tonnes',
  Over10000: 'Over 10,000 tonnes'
}

function formatPercent(val) {
  return val != null ? `${val}%` : '—'
}

function buildBusinessPlanRows(bp) {
  if (!bp) return []
  const categories = [
    { key: 'newInfrastructure', label: 'New infrastructure' },
    { key: 'priceSupport', label: 'Price support' },
    { key: 'businessCollections', label: 'Business collections' },
    { key: 'communications', label: 'Communications' },
    { key: 'newMarkets', label: 'New markets' },
    { key: 'newUses', label: 'New uses' }
  ]
  return categories.flatMap(({ key, label }) => {
    const pct = bp[`${key}Percent`]
    const detail = bp[`${key}Detail`]
    if (pct == null && !detail) return []
    const rows = []
    if (pct != null) {
      rows.push({
        key: { text: `${label} (%)` },
        value: { text: formatPercent(pct) }
      })
    }
    if (detail) {
      rows.push({ key: { text: `${label} (detail)` }, value: { text: detail } })
    }
    return rows
  })
}

export const workItemApplicationDetailsController = {
  async handler(request, h) {
    const { id } = request.params
    const user = request.auth?.credentials

    const result = await getWorkItem({ workItemId: id, user })
    if (!result.ok) {
      return h.redirect(`/work-items/${id}`)
    }
    const workItem = result.workItem

    const p = workItem?.payload ?? {}
    const bp = p.businessPlan ?? {}
    const prns = p.prns ?? {}
    const samplingPlan = p.samplingPlan ?? {}
    const submittedBy = p.submittedBy ?? {}

    // RA-249. The DATA row labelled "Application reference" must show the
    // human RA-* reference or nothing — never the work-item Guid. The
    // navigational label (page title / breadcrumb / caption) may still fall
    // back to the id, where an identifier is legitimately useful.
    const applicationRef = p.applicationReference ?? null
    const workItemLabel = p.applicationReference ?? workItem.id

    let priorYearSection = null
    if (workItem.typeId === RE_ACCREDITATION_TYPE_ID) {
      const priorYearResult = await getReAccreditationPriorYear({
        workItemId: id,
        user
      })
      if (priorYearResult.ok) {
        const py = priorYearResult.priorYear
        priorYearSection = {
          year: py.year,
          tonnageBand: py.tonnageBand
            ? (TONNAGE_BAND_LABELS[py.tonnageBand] ?? py.tonnageBand)
            : '—',
          authorisers: Array.isArray(py.authorisers) ? py.authorisers : [],
          businessPlanRows: buildBusinessPlanRows(py.businessPlan)
        }
      }
    }

    return h.view('work-items/application-details', {
      pageTitle: `Application details — ${workItemLabel}`,
      breadcrumbs: [
        { text: 'Work items', href: '/work-items' },
        { text: workItemLabel, href: `/work-items/${id}` },
        { text: 'Application details' }
      ],
      applicationRef,
      workItemLabel,
      accreditationYear: p.accreditationYear ?? null,
      workItemId: id,
      applicationSection: {
        rows: [
          {
            key: { text: 'Application reference' },
            value: { text: applicationRef }
          },
          {
            key: { text: 'Organisation name' },
            value: { text: p.organisationName || '—' }
          },
          {
            key: { text: 'Registration number' },
            value: { text: p.registrationNumber || '—' }
          },
          {
            key: { text: 'Accreditation year' },
            value: {
              text:
                p.accreditationYear != null ? String(p.accreditationYear) : '—'
            }
          },
          {
            key: { text: 'Previous accreditation year' },
            value: {
              text:
                p.previousAccreditationYear != null
                  ? String(p.previousAccreditationYear)
                  : '—'
            }
          },
          {
            key: { text: 'Compliance issues reported' },
            value: {
              text:
                p.complianceIssuesReported != null
                  ? String(p.complianceIssuesReported)
                  : '—'
            }
          },
          {
            key: { text: 'Material' },
            value: { text: p.material || '—' }
          },
          {
            key: { text: 'Site address' },
            value: { text: formatSiteAddress(p) || '—' }
          },
          {
            key: { text: 'Site postcode' },
            value: { text: getSitePostcode(p) || '—' }
          }
        ]
      },
      operatorSection: {
        rows: [
          {
            key: { text: 'Operator application ID' },
            value: { text: p.operatorApplicationId || '—' }
          },
          {
            key: { text: 'Operator organisation ID' },
            value: { text: p.operatorOrganisationId || '—' }
          },
          {
            key: { text: 'Operator registration ID' },
            value: { text: p.operatorRegistrationId || '—' }
          },
          {
            key: { text: 'Operator email' },
            value: { text: p.operatorEmail || '—' }
          }
        ]
      },
      submittedBySection: submittedBy.fullName
        ? {
            rows: [
              {
                key: { text: 'Full name' },
                value: { text: submittedBy.fullName }
              },
              {
                key: { text: 'Job title' },
                value: { text: submittedBy.jobTitle || '—' }
              },
              {
                key: { text: 'Email' },
                value: { text: submittedBy.email || '—' }
              }
            ]
          }
        : null,
      prnsSection: {
        tonnageBand: prns.plannedTonnageBand
          ? (TONNAGE_BAND_LABELS[prns.plannedTonnageBand] ??
            prns.plannedTonnageBand)
          : '—',
        authorisers: Array.isArray(prns.authorisers) ? prns.authorisers : []
      },
      businessPlanRows: buildBusinessPlanRows(bp),
      samplingPlanFiles: Array.isArray(samplingPlan.files)
        ? samplingPlan.files
        : [],
      priorYearSection
    })
  }
}
