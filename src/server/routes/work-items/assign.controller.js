/**
 * Reassign / unassign interstitials (RA-295 AC03).
 *
 * The prototype's assignment panel offers "Reassign the application" and
 * "Unassign the application" as LINKS rather than inline controls, so each
 * gets a small GET page that collects the choice (or the confirmation) and
 * posts to the existing `POST /work-items/{id}/assign` and
 * `POST /work-items/{id}/unassign` handlers in `detail.controller.js`.
 *
 * This mirrors the withdraw (RA-188) and query (RA-291) interstitials: a
 * link, a confirmation page, then a PRG-redirecting POST. It keeps the
 * detail page free of a form the user rarely needs, and it keeps every
 * mutation behind a CSRF-protected POST — a link can never change state.
 *
 * Neither page re-implements authorisation: the backend is the source of
 * truth and rejects anything the caller may not do (RA-323).
 */

import { getWorkItem } from '#/server/common/helpers/backend-api/backend-api.js'
import { getUser } from '#/server/common/helpers/auth/get-user.js'
import { getAssignableUsers } from '#/server/work-items/core/assignees.js'

const NOT_FOUND_VIEW = 'work-items/not-found'
const UNAVAILABLE_VIEW = 'work-items/detail-error'
const ASSIGN_VIEW = 'work-items/assign'
const UNASSIGN_VIEW = 'work-items/unassign'

function detailHref(id) {
  return `/work-items/${encodeURIComponent(id)}`
}

function breadcrumbs(id, ref, leaf) {
  return [
    { text: 'Applications', href: '/work-items' },
    { text: ref ?? 'Application', href: detailHref(id) },
    { text: leaf }
  ]
}

/**
 * Fetch the work item, returning either `{ workItem }` or `{ response }`
 * carrying the rendered not-found / unavailable page. Same shape and same
 * status codes as the query controller's loader.
 */
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
            { text: 'Applications', href: '/work-items' },
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
            { text: 'Applications', href: '/work-items' },
            { text: 'Application' }
          ]
        })
        .code(502)
    }
  }

  return { workItem: result.workItem }
}

export function makeShowAssignController() {
  return {
    async handler(request, h) {
      const id = request.params.id
      const loaded = await loadWorkItem(request, h, id)
      if (loaded.response) return loaded.response

      const workItem = loaded.workItem
      const applicationRef = workItem.payload?.applicationReference ?? null

      return h.view(ASSIGN_VIEW, {
        pageTitle: 'Reassign the application',
        heading: 'Reassign the application',
        breadcrumbs: breadcrumbs(id, applicationRef, 'Reassign'),
        workItemId: id,
        applicationRef,
        assignedToName:
          workItem.assignedToName ?? workItem.assignedToId ?? null,
        formAction: `${detailHref(id)}/assign`,
        cancelHref: detailHref(id),
        assignableUsers: getAssignableUsers().map((u) => ({
          value: u.id,
          text: u.name ?? u.id,
          selected: u.id === workItem.assignedToId
        }))
      })
    }
  }
}

export function makeShowUnassignController() {
  return {
    async handler(request, h) {
      const id = request.params.id
      const loaded = await loadWorkItem(request, h, id)
      if (loaded.response) return loaded.response

      const workItem = loaded.workItem
      const applicationRef = workItem.payload?.applicationReference ?? null

      return h.view(UNASSIGN_VIEW, {
        pageTitle: 'Unassign the application',
        heading: 'Unassign the application',
        breadcrumbs: breadcrumbs(id, applicationRef, 'Unassign'),
        workItemId: id,
        applicationRef,
        assignedToName:
          workItem.assignedToName ?? workItem.assignedToId ?? null,
        // AC03 keeps the link available in every state, so the page has to
        // cope with an application that is already unassigned: it explains
        // the situation instead of offering a no-op confirm button.
        isUnassigned: !workItem.assignedToId,
        formAction: `${detailHref(id)}/unassign`,
        cancelHref: detailHref(id)
      })
    }
  }
}
