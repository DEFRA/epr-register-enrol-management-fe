import { getWorkItem } from '#/server/common/helpers/backend-api/backend-api.js'
import { getWorkItemType } from '#/server/work-items/core/registry.js'
import { resolveDetailTemplate } from '#/server/work-items/core/templates.js'
import { createWorkItemActionsService } from '#/server/work-items/core/service.js'

const NOT_FOUND_VIEW = 'work-items/not-found'
const UNAVAILABLE_VIEW = 'work-items/detail-error'

/**
 * Render a single work item.
 *
 * The backend's `WorkItemResponse` already carries the engine projection
 * (tasks + available actions) and the `templateVersion` the item was
 * assessed against, so we:
 *   1. Fetch it via the backend client.
 *   2. Pick the detail template registered for `(typeId, templateVersion)`,
 *      falling back to the generic core template, so historical items keep
 *      their original look even after the live module ships a new template.
 *   3. Decorate with display-name lookups so templates don't have to know
 *      about the registry.
 *
 * The action handlers below render this view in-place with an inline
 * `notice` banner on engine failure rather than redirecting, so the user
 * sees the engine's reason attached to the up-to-date detail view.
 */
export const workItemDetailController = {
  async handler(request, h) {
    return renderDetail({ request, h })
  }
}

export function makeCompleteTaskController({
  service = createWorkItemActionsService()
} = {}) {
  return {
    async handler(request, h) {
      const { id, taskId } = request.params
      const result = await service.completeTask({ workItemId: id, taskId })

      if (result.ok) {
        // PRG: redirect-after-post so refresh is harmless and the URL stays
        // clean of one-shot state.
        return h.redirect(`/work-items/${encodeURIComponent(id)}`)
      }
      return renderDetailFromResult({ request, h, id, result, actionLabel: `mark task "${taskId}" complete` })
    }
  }
}

export function makeApplyActionController({
  service = createWorkItemActionsService()
} = {}) {
  return {
    async handler(request, h) {
      const { id, actionId } = request.params
      const result = await service.applyAction({ workItemId: id, actionId })

      if (result.ok) {
        return h.redirect(`/work-items/${encodeURIComponent(id)}`)
      }
      return renderDetailFromResult({ request, h, id, result, actionLabel: actionId })
    }
  }
}

async function renderDetail({ request, h, notice = null, statusCode = 200 }) {
  const id = request.params.id
  const result = await getWorkItem({ workItemId: id })

  if (result.ok === false && result.status === 404) {
    return h
      .view(NOT_FOUND_VIEW, {
        pageTitle: 'Work item not found',
        heading: 'Work item not found',
        workItemId: id,
        breadcrumbs: [
          { text: 'Home', href: '/' },
          { text: 'Work items', href: '/work-items' },
          { text: 'Not found' }
        ]
      })
      .code(404)
  }

  if (!result.ok) {
    return h
      .view(UNAVAILABLE_VIEW, {
        pageTitle: 'Work item unavailable',
        heading: 'Work item unavailable',
        workItemId: id,
        error: result.error ?? `Backend returned ${result.status}`,
        breadcrumbs: [
          { text: 'Home', href: '/' },
          { text: 'Work items', href: '/work-items' },
          { text: id }
        ]
      })
      .code(502)
  }

  const decorated = decorate(result.workItem)
  const templatePath = resolveDetailTemplate(
    decorated.typeId,
    decorated.templateVersion
  )

  return h
    .view(templatePath, {
      pageTitle: `Work item ${decorated.id}`,
      heading: decorated.typeDisplayName,
      breadcrumbs: [
        { text: 'Home', href: '/' },
        { text: 'Work items', href: '/work-items' },
        { text: decorated.id }
      ],
      workItem: decorated,
      notice
    })
    .code(statusCode)
}

function renderDetailFromResult({ request, h, id, result, actionLabel }) {
  // Engine rejections (incomplete tasks, invalid transition, unknown action)
  // and transport errors are surfaced inline on a fresh detail render so the
  // user sees the message tied to the current state of the work item.
  request.params.id = id
  const statusCode = result.reason === 'not-allowed' ? 409 : 400
  const notice = {
    kind: 'error',
    title: `Could not ${actionLabel}`,
    message: result.message ?? 'Action failed'
  }
  return renderDetail({ request, h, notice, statusCode })
}

function decorate(workItem) {
  const type = getWorkItemType(workItem.typeId)
  const stateDisplayName =
    type?.states?.find((state) => state.id === workItem.stateId)?.displayName ??
    workItem.stateId
  return {
    ...workItem,
    typeDisplayName: type?.displayName ?? workItem.typeId,
    stateDisplayName,
    payloadJson: safeStringify(workItem.payload)
  }
}

function safeStringify(value) {
  try {
    return JSON.stringify(value ?? {}, null, 2)
  } catch {
    return ''
  }
}
