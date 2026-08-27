/**
 * Recycling operations edit controllers (RA-469 8pi).
 *
 *  - GET  /work-items/{id}/recycling-operations/{siteId} — the edit form,
 *    pre-populated with the site's current codes, offering only the codes
 *    applicable to the application's material type (AC9).
 *  - POST /work-items/{id}/recycling-operations/{siteId} — validates the
 *    submitted codes (AC10-AC12), hands off to
 *    {@link createRecyclingOperationsService}, and PRG-redirects back to
 *    the Recycling operations list with a flash banner (AC13).
 *
 * Structurally mirrors `query.controller.js`: validation failures
 * re-render the form in place with `.code(400)` and an error summary;
 * backend failures (including AC14's 403) redirect with an error banner,
 * never a 500.
 */

import { getWorkItem } from '#/server/common/helpers/backend-api/backend-api.js'
import { getUser } from '#/server/common/helpers/auth/get-user.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { getWorkItemType } from '#/server/work-items/core/registry.js'
import { stateTagClass } from '#/server/work-items/core/state-badge.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'
import { buildCaseHeader, buildCaseTabs } from './case-header.js'
import { renderWorkItemFetchError } from './work-item-fetch-errors.js'
import {
  applicableCodesForMaterialType,
  buildErrorSummary,
  recyclingOperationLabel,
  validateRecyclingOperationsForm
} from './recycling-operations.schema.js'
import { createRecyclingOperationsService } from './recycling-operations-edit.service.js'
import { isSiteSelected } from './overseas-sites.js'

const VIEW_PATH = 'work-items/recycling-operations-edit'
const NOT_FOUND_VIEW = 'work-items/not-found'
const PAGE_TITLE = 'Change recycling operations'

const logger = createLogger()

function listHref(id) {
  return `/work-items/${encodeURIComponent(id)}/recycling-operations`
}

function editFormAction(id, siteId) {
  return `/work-items/${encodeURIComponent(id)}/recycling-operations/${encodeURIComponent(siteId)}`
}

function flashBanner(request, banner) {
  request.yar?.flash?.('flashBanner', banner)
}

function findSite(workItem, siteId) {
  const sites = workItem?.payload?.overseasSites?.sites
  if (!Array.isArray(sites)) {
    return null
  }
  // The route param is always a string, but the operator backend's
  // OverseasSiteModel.SiteId is a C# int, which round-trips through JSON as
  // a number — a strict === here would never match real seeded/production
  // data (only ever matched the test suite's own string-typed fixtures).
  // RA-483: a site the operator removed is not on the list this form is
  // reached from, so it must not be editable by URL either — treat it as
  // not found rather than serving a form that would write codes back onto
  // a site no longer part of the application.
  return (
    sites.find(
      (site) =>
        site?.siteId != null &&
        String(site.siteId) === siteId &&
        isSiteSelected(site)
    ) ?? null
  )
}

function siteNotFoundResponse(h, id) {
  return h
    .view(NOT_FOUND_VIEW, {
      pageTitle: 'Site not found',
      heading: 'Site not found',
      workItemId: id,
      breadcrumbs: [
        { text: 'Applications', href: '/work-items' },
        { text: 'Not found' }
      ]
    })
    .code(statusCodes.notFound)
}

/** AC9: only the codes applicable to the application's material type are offered. */
function codeItems(applicableCodes, selectedCodes) {
  const chosen = new Set(selectedCodes)
  return applicableCodes.map((code) => ({
    value: code,
    text: recyclingOperationLabel(code),
    checked: chosen.has(code)
  }))
}

function caseHeaderFor(workItem) {
  const type = getWorkItemType(workItem.typeId)
  const stateDisplayName =
    type?.states?.find((s) => s.id === workItem.stateId)?.displayName ??
    workItem.stateId
  return buildCaseHeader({
    workItem: {
      ...workItem,
      stateDisplayName,
      stateTagClass: stateTagClass(workItem.stateId)
    }
  })
}

function renderForm(
  h,
  {
    id,
    siteId,
    workItem,
    site,
    values,
    fieldErrors = {},
    errorSummary = null,
    statusCode = 200
  }
) {
  const applicableCodes = applicableCodesForMaterialType(
    workItem.payload?.material
  )

  return h
    .view(VIEW_PATH, {
      pageTitle: errorSummary ? `Error: ${PAGE_TITLE}` : PAGE_TITLE,
      heading: PAGE_TITLE,
      caseHeader: caseHeaderFor(workItem),
      caseTabs: buildCaseTabs({
        workItemId: workItem.id,
        active: 'recycling-operations'
      }),
      workItem: { id, applicationRef: workItem.payload?.applicationReference },
      site: { siteId, siteName: site?.siteName ?? null },
      formAction: editFormAction(id, siteId),
      cancelHref: listHref(id),
      codeItems: codeItems(applicableCodes, values.codes),
      values,
      fieldErrors,
      errorSummary
    })
    .code(statusCode)
}

export function makeShowRecyclingOperationsEditController() {
  return {
    async handler(request, h) {
      const id = request.params.id
      const siteId = request.params.siteId
      const user = getUser(request)
      const result = await getWorkItem({ workItemId: id, user })

      const errorResponse = renderWorkItemFetchError({ h, result, id })
      if (errorResponse) {
        return errorResponse
      }

      const workItem = result.workItem
      const site = findSite(workItem, siteId)
      if (!site) {
        return siteNotFoundResponse(h, id)
      }

      // AC9: pre-populated with the site's current selection.
      const codes = Array.isArray(site.operationCodes)
        ? site.operationCodes
        : []

      return renderForm(h, {
        id,
        siteId,
        workItem,
        site,
        values: { codes }
      })
    }
  }
}

export function makeSubmitRecyclingOperationsEditController({
  service = createRecyclingOperationsService()
} = {}) {
  return {
    async handler(request, h) {
      const id = request.params.id
      const siteId = request.params.siteId
      const user = getUser(request)
      const result = await getWorkItem({ workItemId: id, user })

      const errorResponse = renderWorkItemFetchError({ h, result, id })
      if (errorResponse) {
        return errorResponse
      }

      const workItem = result.workItem
      const site = findSite(workItem, siteId)
      if (!site) {
        return siteNotFoundResponse(h, id)
      }

      const applicableCodes = applicableCodesForMaterialType(
        workItem.payload?.material
      )
      // AC11: R12/R13 require an associated interim site.
      const hasInterimSite = Boolean(site.interimSite)

      const validation = validateRecyclingOperationsForm(request.payload, {
        applicableCodes,
        hasInterimSite
      })

      if (!validation.ok) {
        return renderForm(h, {
          id,
          siteId,
          workItem,
          site,
          values: validation.values,
          fieldErrors: validation.fieldErrors,
          errorSummary: buildErrorSummary(validation.fieldErrors),
          statusCode: 400
        })
      }

      const updateResult = await service.updateCodes({
        workItemId: id,
        siteId,
        operationCodes: validation.value.codes,
        user
      })

      if (updateResult.ok) {
        // AC13: success confirmation banner, updated codes visible
        // immediately on the list the redirect lands on.
        flashBanner(request, {
          type: 'success',
          title: 'Recycling operations updated',
          text: `The recycling operation codes for ${site.siteName || 'this site'} have been updated.`
        })
        return h.redirect(listHref(id))
      }

      logger.warn(
        {
          workItemId: id,
          siteId,
          outcome: updateResult.outcome,
          message: updateResult.message
        },
        'Recycling operations update failed'
      )

      // AC14: a 403 (nation-scoping denial) redirects with a clear
      // not-authorized error banner, never a 500 — same PRG shape as every
      // other outcome here.
      flashBanner(request, bannerForFailure(updateResult))
      return h.redirect(listHref(id))
    }
  }
}

function bannerForFailure(result) {
  const title = 'Could not update the recycling operations'
  if (result.outcome === 'forbidden') {
    return {
      type: 'error',
      title,
      text: 'You do not have permission to update this site.'
    }
  }
  if (result.outcome === 'not-found') {
    return { type: 'error', title, text: 'This site no longer exists.' }
  }
  if (result.outcome === 'conflict') {
    return {
      type: 'error',
      title,
      text: 'This site has been updated by someone else. Refresh and try again.'
    }
  }
  if (result.outcome === 'invalid') {
    return { type: 'error', title, text: result.message }
  }
  return {
    type: 'error',
    title,
    text: 'There was a problem updating the recycling operations. Try again.'
  }
}
