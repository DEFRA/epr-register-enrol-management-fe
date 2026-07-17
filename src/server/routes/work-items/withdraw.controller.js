/**
 * Withdraw confirmation controllers (RA-188).
 *
 *  - GET  /work-items/{id}/actions/{actionId}/confirm — interstitial
 *    page with a warning, optional note textarea and primary "Yes,
 *    withdraw this work item" submit. Fetches the work item up front
 *    so we can validate that the action is still available before
 *    rendering and back-link safely.
 *  - POST /work-items/{id}/actions/{actionId}/confirm — validates the
 *    note length, hands off to {@link createWithdrawService} and
 *    PRG-redirects back to the work item detail page with a flash
 *    banner on success / non-validation failure.
 *
 * The confirmation page is only mounted for action ids that look like
 * withdraw transitions (`withdraw`, `withdraw-during-*`). The generic
 * action POST at `/work-items/{id}/actions/{actionId}` still services
 * everything else — the detail template swaps the form for a link to
 * this interstitial when it spots a withdraw action.
 */

import { getWorkItem } from '#/server/common/helpers/backend-api/backend-api.js'
import { getUser } from '#/server/common/helpers/auth/get-user.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'

import {
  WITHDRAW_NOTE_MAX_LENGTH,
  createWithdrawService,
  isWithdrawActionId
} from './withdraw.service.js'

const VIEW_PATH = 'work-items/withdraw'
const NOT_FOUND_VIEW = 'work-items/not-found'
const UNAVAILABLE_VIEW = 'work-items/detail-error'

const logger = createLogger()

function detailHref(id) {
  return `/work-items/${encodeURIComponent(id)}`
}

function confirmHref(id, actionId) {
  return `/work-items/${encodeURIComponent(id)}/actions/${encodeURIComponent(actionId)}/confirm`
}

function breadcrumbs(id, ref) {
  return [
    { text: 'Work items', href: '/work-items' },
    { text: ref ?? 'Work item', href: detailHref(id) },
    { text: 'Withdraw' }
  ]
}

function flashBanner(request, banner) {
  request.yar?.flash?.('flashBanner', banner)
}

function findAvailableAction(workItem, actionId) {
  const actions = Array.isArray(workItem?.availableActions)
    ? workItem.availableActions
    : []
  return actions.find((a) => a?.actionId === actionId) ?? null
}

function rejectNonWithdraw(request, h, id) {
  flashBanner(request, {
    type: 'error',
    text: 'This action does not require a withdrawal confirmation.'
  })
  return h.redirect(detailHref(id))
}

export function makeShowWithdrawController() {
  return {
    async handler(request, h) {
      const id = request.params.id
      const actionId = request.params.actionId
      if (!isWithdrawActionId(actionId)) {
        return rejectNonWithdraw(request, h, id)
      }

      const user = getUser(request)
      const result = await getWorkItem({ workItemId: id, user })

      if (result.ok === false && result.status === 404) {
        return h
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

      if (!result.ok) {
        return h
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

      const workItem = result.workItem
      const applicationRef = workItem.payload.applicationReference
      const available = findAvailableAction(workItem, actionId)
      if (!available) {
        flashBanner(request, {
          type: 'error',
          text: 'This work item can no longer be withdrawn from its current state.'
        })
        return h.redirect(detailHref(id))
      }

      return h.view(VIEW_PATH, {
        pageTitle: 'Withdraw this work item',
        heading: 'Are you sure you want to withdraw this work item?',
        breadcrumbs: breadcrumbs(id, applicationRef),
        workItem: { ...workItem, applicationRef },
        actionId,
        actionDisplayName: available.displayName ?? 'Withdraw',
        formAction: confirmHref(id, actionId),
        cancelHref: detailHref(id),
        noteMaxLength: WITHDRAW_NOTE_MAX_LENGTH,
        values: { note: '' },
        errorSummary: null,
        fieldErrors: {}
      })
    }
  }
}

export function makeSubmitWithdrawController({
  service = createWithdrawService()
} = {}) {
  return {
    async handler(request, h) {
      const id = request.params.id
      const actionId = request.params.actionId
      if (!isWithdrawActionId(actionId)) {
        return rejectNonWithdraw(request, h, id)
      }
      const user = getUser(request)
      const payload = request.payload ?? {}
      const note = typeof payload.note === 'string' ? payload.note : ''

      if (note.length > WITHDRAW_NOTE_MAX_LENGTH) {
        const itemResult = await getWorkItem({ workItemId: id, user })
        const applicationRef = itemResult.ok
          ? itemResult.workItem.payload.applicationReference
          : null
        return h
          .view(VIEW_PATH, {
            pageTitle: 'Error: Withdraw this work item',
            heading: 'Are you sure you want to withdraw this work item?',
            breadcrumbs: breadcrumbs(id, applicationRef),
            workItem: { id, applicationRef },
            actionId,
            actionDisplayName: 'Withdraw',
            formAction: confirmHref(id, actionId),
            cancelHref: detailHref(id),
            noteMaxLength: WITHDRAW_NOTE_MAX_LENGTH,
            values: { note },
            errorSummary: {
              titleText: 'There is a problem',
              items: [
                {
                  text: `Note must be ${WITHDRAW_NOTE_MAX_LENGTH} characters or fewer`,
                  href: '#field-note'
                }
              ]
            },
            fieldErrors: {
              note: `Note must be ${WITHDRAW_NOTE_MAX_LENGTH} characters or fewer`
            }
          })
          .code(400)
      }

      const result = await service.withdrawWorkItem({
        workItemId: id,
        actionId,
        note,
        user
      })

      if (result.ok) {
        flashBanner(request, {
          type: 'success',
          title: 'Work item withdrawn',
          text: 'The work item has been withdrawn.'
        })
        return h.redirect(detailHref(id))
      }

      logger.warn(
        {
          workItemId: id,
          actionId,
          outcome: result.outcome,
          message: result.message
        },
        'Withdraw work item failed'
      )

      flashBanner(request, bannerForFailure(result))
      return h.redirect(detailHref(id))
    }
  }
}

function bannerForFailure(result) {
  if (result.outcome === 'conflict') {
    return {
      type: 'error',
      title: 'Could not withdraw this work item',
      text: 'The work item state changed. Refresh and try again.'
    }
  }
  if (result.outcome === 'forbidden') {
    return {
      type: 'error',
      title: 'Could not withdraw this work item',
      text: 'You do not have permission to perform this action.'
    }
  }
  if (result.outcome === 'note-failed') {
    return {
      type: 'error',
      title: 'Could not save the withdrawal note',
      text:
        result.message ??
        'Your withdrawal note could not be saved, so the work item was not withdrawn. Try again.'
    }
  }
  return {
    type: 'error',
    title: 'Could not withdraw this work item',
    text: 'There was a problem withdrawing this work item. Try again.'
  }
}
