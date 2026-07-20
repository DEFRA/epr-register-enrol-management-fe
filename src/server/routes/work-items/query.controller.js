/**
 * Query-an-application controllers (RA-291).
 *
 *  - GET  /work-items/{id}/query — the query form. Fetches the work item
 *    up front so we can confirm the application is still queryable and
 *    caption the page with its reference.
 *  - POST /work-items/{id}/query — validates sections + reason, hands off
 *    to {@link createQueryService} and PRG-redirects back to the detail
 *    page with a flash banner (AC05).
 *
 * Validation failures re-render the form in place with `.code(400)` and
 * an error summary; backend failures redirect with an error banner, the
 * same shape the withdraw flow uses.
 */

import { getWorkItem } from '#/server/common/helpers/backend-api/backend-api.js'
import { getUser } from '#/server/common/helpers/auth/get-user.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'

import {
  QUERY_REASON_MAX_WORDS,
  QUERY_SECTION_OPTIONS,
  buildErrorSummary,
  validateQueryForm
} from './query.schema.js'
import { createQueryService } from './query.service.js'

const VIEW_PATH = 'work-items/query'
const NOT_FOUND_VIEW = 'work-items/not-found'
const UNAVAILABLE_VIEW = 'work-items/detail-error'
const PAGE_TITLE = 'Query'

const logger = createLogger()

function detailHref(id) {
  return `/work-items/${encodeURIComponent(id)}`
}

function queryHref(id) {
  return `/work-items/${encodeURIComponent(id)}/query`
}

function breadcrumbs(id, ref) {
  return [
    { text: 'Work items', href: '/work-items' },
    { text: ref ?? 'Work item', href: detailHref(id) },
    { text: PAGE_TITLE }
  ]
}

function flashBanner(request, banner) {
  request.yar?.flash?.('flashBanner', banner)
}

/**
 * A query transition is any action the backend projects whose id is
 * `query` or `query-<something>`. Deriving the affordance from the
 * projection rather than from state names means the link disappears by
 * itself once the item has already been queried.
 */
export function isQueryActionId(actionId) {
  if (typeof actionId !== 'string') return false
  return actionId === 'query' || actionId.startsWith('query-')
}

export function hasQueryAction(workItem) {
  const actions = Array.isArray(workItem?.availableActions)
    ? workItem.availableActions
    : []
  return actions.some((a) => isQueryActionId(a?.actionId))
}

function sectionOptions(selected) {
  const chosen = new Set(selected)
  return QUERY_SECTION_OPTIONS.map((o) => ({
    value: o.value,
    text: o.text,
    checked: chosen.has(o.value)
  }))
}

function renderForm(
  h,
  {
    id,
    applicationRef,
    values = { sections: [], reason: '' },
    fieldErrors = {},
    errorSummary = null,
    statusCode = 200
  }
) {
  return h
    .view(VIEW_PATH, {
      pageTitle: errorSummary ? `Error: ${PAGE_TITLE}` : PAGE_TITLE,
      heading: PAGE_TITLE,
      breadcrumbs: breadcrumbs(id, applicationRef),
      workItem: { id, applicationRef },
      formAction: queryHref(id),
      cancelHref: detailHref(id),
      maxWords: QUERY_REASON_MAX_WORDS,
      sectionItems: sectionOptions(values.sections),
      values,
      fieldErrors,
      errorSummary
    })
    .code(statusCode)
}

async function loadWorkItem(request, h, id) {
  const user = getUser(request)
  const result = await getWorkItem({ workItemId: id, user })

  if (result.ok === false && result.status === 404) {
    return {
      response: h
        .view(NOT_FOUND_VIEW, {
          pageTitle: 'Work item not found',
          heading: 'Work item not found',
          workItemId: id,
          breadcrumbs: [
            { text: 'Work items', href: '/work-items' },
            { text: 'Not found' }
          ]
        })
        .code(404)
    }
  }

  if (!result.ok) {
    return {
      response: h
        .view(UNAVAILABLE_VIEW, {
          pageTitle: 'Work item unavailable',
          heading: 'Work item unavailable',
          workItemId: id,
          error: result.error ?? `Backend returned ${result.status}`,
          breadcrumbs: [
            { text: 'Work items', href: '/work-items' },
            { text: 'Work item' }
          ]
        })
        .code(502)
    }
  }

  return { workItem: result.workItem }
}

export function makeShowQueryController() {
  return {
    async handler(request, h) {
      const id = request.params.id
      const loaded = await loadWorkItem(request, h, id)
      if (loaded.response) return loaded.response

      const workItem = loaded.workItem
      if (!hasQueryAction(workItem)) {
        flashBanner(request, {
          type: 'error',
          text: 'This application cannot be queried in its current state.'
        })
        return h.redirect(detailHref(id))
      }

      return renderForm(h, {
        id,
        applicationRef: workItem.payload?.applicationReference ?? null
      })
    }
  }
}

export function makeSubmitQueryController({
  service = createQueryService()
} = {}) {
  return {
    async handler(request, h) {
      const id = request.params.id
      const user = getUser(request)
      // `validateQueryForm` tolerates a null/undefined payload itself, so
      // there is no need to defend against it twice.
      const validation = validateQueryForm(request.payload)

      if (!validation.ok) {
        const item = await getWorkItem({ workItemId: id, user })
        return renderForm(h, {
          id,
          applicationRef: item.ok
            ? (item.workItem.payload?.applicationReference ?? null)
            : null,
          values: validation.values,
          fieldErrors: validation.fieldErrors,
          errorSummary: buildErrorSummary(validation.fieldErrors),
          statusCode: 400
        })
      }

      const result = await service.raiseQuery({
        workItemId: id,
        sections: validation.value.sections,
        reason: validation.value.reason,
        user
      })

      if (result.ok) {
        flashBanner(request, {
          type: 'success',
          title: 'Query sent',
          text: 'The query has been sent to the operator and the application has been assigned to you.'
        })
        return h.redirect(detailHref(id))
      }

      logger.warn(
        { workItemId: id, outcome: result.outcome, message: result.message },
        'Query application failed'
      )

      flashBanner(request, bannerForFailure(result))
      return h.redirect(detailHref(id))
    }
  }
}

function bannerForFailure(result) {
  const title = 'Could not send the query'
  if (result.outcome === 'conflict') {
    return {
      type: 'error',
      title,
      text: 'This application cannot be queried in its current state. Refresh and try again.'
    }
  }
  if (result.outcome === 'forbidden') {
    return {
      type: 'error',
      title,
      text: 'You do not have permission to query this application.'
    }
  }
  if (result.outcome === 'not-found') {
    return { type: 'error', title, text: 'This application no longer exists.' }
  }
  if (result.outcome === 'invalid') {
    // The service guarantees a message, defaulting it if the backend
    // returned no problem-details body.
    return { type: 'error', title, text: result.message }
  }
  return {
    type: 'error',
    title,
    text: 'There was a problem sending the query. Try again.'
  }
}
