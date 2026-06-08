/**
 * Re-accreditation approve-determination controllers (RA-132).
 *
 * Two handlers — both at `/work-items/re-accreditation/{id}/approve`:
 *
 *  - GET: render the confirmation interstitial with a warning, an
 *    optional decision-note textarea and a primary "Approve
 *    determination" submit button. Fetches the underlying work item up
 *    front so the page can show its id and protect against navigating
 *    to a missing / non-eligible work item.
 *
 *  - POST: ask the service to post the optional decision note and then
 *    invoke the type-specific approve endpoint. Always PRG-redirects
 *    back to the work item detail page with a flash banner — success,
 *    conflict or generic error. Never bubbles a 500 to the user from
 *    the approval call alone.
 */

import { getWorkItem } from '#/server/common/helpers/backend-api/backend-api.js'
import { getUser } from '#/server/common/helpers/auth/get-user.js'
import { ROLE_DECISION_MAKER } from '#/server/common/helpers/auth/auth-scopes.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'

import {
  APPROVAL_DECISION_NOTE_MAX_LENGTH,
  createApprovalService
} from './service.js'

const VIEW_PATH = 're-accreditation/approval/index'
const NOT_FOUND_VIEW = 'work-items/not-found'
const UNAVAILABLE_VIEW = 'work-items/detail-error'

const PAGE_TITLE = 'Approve this re-accreditation determination'
const ELIGIBLE_STATE_ID = 'awaiting-decision'

const logger = createLogger()

function detailHref(id) {
  return `/work-items/${encodeURIComponent(id)}`
}

function approveHref(id) {
  return `/work-items/re-accreditation/${encodeURIComponent(id)}/approve`
}

function breadcrumbs(id, ref) {
  return [
    { text: 'Home', href: '/' },
    { text: 'Work items', href: '/work-items' },
    { text: ref ?? 'Work item', href: detailHref(id) },
    { text: 'Approve' }
  ]
}

function flashBanner(request, banner) {
  request.yar?.flash?.('flashBanner', banner)
}

/**
 * GET — render the confirmation interstitial.
 */
export function makeShowApprovalController() {
  return {
    async handler(request, h) {
      const id = request.params.id
      const user = getUser(request)
      const result = await getWorkItem({ workItemId: id, user })

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

      const workItem = result.workItem
      const applicationRef = workItem.payload.applicationReference

      // Defensive UX: if the underlying state is no longer eligible (the
      // user followed a stale link or the state moved on between page
      // loads), redirect back to the detail page rather than letting
      // them submit a request the backend will reject. The detail page
      // is read-only in terminal states and explains the new status.
      if (workItem.stateId !== ELIGIBLE_STATE_ID) {
        flashBanner(request, {
          type: 'error',
          text: 'This work item can no longer be approved from its current state.'
        })
        return h.redirect(detailHref(id))
      }

      // Mirror the FE button-visibility rule from
      // `applyReAccreditationViewModel`: the caller must either be the
      // current assignee or hold the decision-maker role. The backend
      // remains authoritative, but redirecting here gives the user a
      // clearer message than a generic POST failure banner.
      const scope = request.auth?.credentials?.scope ?? []
      const hasDecisionMakerRole = scope.includes(ROLE_DECISION_MAKER)
      const callerIsAssignee =
        user?.id != null && workItem.assignedToId === user.id
      if (!callerIsAssignee && !hasDecisionMakerRole) {
        flashBanner(request, {
          type: 'error',
          text: 'You do not have permission to approve this work item.'
        })
        return h.redirect(detailHref(id))
      }

      return h.view(VIEW_PATH, {
        pageTitle: PAGE_TITLE,
        heading: PAGE_TITLE,
        breadcrumbs: breadcrumbs(id, applicationRef),
        workItem: { ...workItem, applicationRef },
        formAction: approveHref(id),
        cancelHref: detailHref(id),
        decisionNoteMaxLength: APPROVAL_DECISION_NOTE_MAX_LENGTH,
        values: { decisionNote: '' },
        errorSummary: null,
        fieldErrors: {}
      })
    }
  }
}

/**
 * POST — submit the approval. PRG-redirects back to the detail page
 * with a flash banner in every branch.
 */
export function makeSubmitApprovalController({
  service = createApprovalService()
} = {}) {
  return {
    async handler(request, h) {
      const id = request.params.id
      const user = getUser(request)
      const payload = request.payload ?? {}
      const decisionNote =
        typeof payload.decisionNote === 'string' ? payload.decisionNote : ''

      // Client-side length guard so the error renders inline on the
      // interstitial rather than after a redirect — the textarea has the
      // character-count component and the user expects feedback in place.
      if (decisionNote.length > APPROVAL_DECISION_NOTE_MAX_LENGTH) {
        const result = await getWorkItem({ workItemId: id, user })
        const applicationRef = result.ok
          ? result.workItem.payload.applicationReference
          : id

        return h
          .view(VIEW_PATH, {
            pageTitle: `Error: ${PAGE_TITLE}`,
            heading: PAGE_TITLE,
            breadcrumbs: breadcrumbs(id, applicationRef),
            workItem: result.ok
              ? { ...result.workItem, applicationRef }
              : { id },
            formAction: approveHref(id),
            cancelHref: detailHref(id),
            decisionNoteMaxLength: APPROVAL_DECISION_NOTE_MAX_LENGTH,
            values: { decisionNote },
            errorSummary: {
              titleText: 'There is a problem',
              items: [
                {
                  text: `Decision note must be ${APPROVAL_DECISION_NOTE_MAX_LENGTH} characters or fewer`,
                  href: '#field-decisionNote'
                }
              ]
            },
            fieldErrors: {
              decisionNote: `Decision note must be ${APPROVAL_DECISION_NOTE_MAX_LENGTH} characters or fewer`
            }
          })
          .code(400)
      }

      const result = await service.approveWorkItem({
        workItemId: id,
        decisionNote,
        user
      })

      if (result.ok) {
        flashBanner(request, {
          type: 'success',
          title: 'Determination approved',
          text: 'The accreditation has been issued and the applicant will be notified.'
        })
        return h.redirect(detailHref(id))
      }

      const banner = bannerForFailure(result)
      // Log every non-success outcome so an unexpected 5xx still leaves
      // a breadcrumb even though the user only sees a generic banner.
      logger.warn(
        {
          workItemId: id,
          outcome: result.outcome,
          status: result.status,
          message: result.message
        },
        'Re-accreditation approval failed'
      )
      flashBanner(request, banner)
      return h.redirect(detailHref(id))
    }
  }
}

function bannerForFailure(result) {
  if (result.outcome === 'conflict') {
    return {
      type: 'error',
      title: 'Could not approve this determination',
      text: 'Someone else updated this case. Refresh and try again.'
    }
  }
  if (result.outcome === 'note-failed') {
    return {
      type: 'error',
      title: 'Could not save the decision note',
      text:
        result.message ??
        'Your decision note could not be saved, so the approval was not submitted. Try again.'
    }
  }
  return {
    type: 'error',
    title: 'Could not approve this determination',
    text: 'There was a problem approving this determination. Try again.'
  }
}
