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
import { createLogger } from '#/server/common/helpers/logging/logger.js'

import { evaluateApproveEligibility } from '../approve-eligibility.js'
import {
  APPROVAL_DECISION_NOTE_MAX_LENGTH,
  createApprovalService
} from './service.js'

const VIEW_PATH = 're-accreditation/approval/index'
const NOT_FOUND_VIEW = 'work-items/not-found'
const UNAVAILABLE_VIEW = 'work-items/detail-error'

const PAGE_TITLE = 'Approve this re-accreditation determination'

const logger = createLogger()

/**
 * RA-346. Banner for an approval that is not (or is no longer) permitted.
 *
 * `reason` is the engine's rejection code from `evaluateApproveEligibility`.
 * The tasks-incomplete case gets its own copy because it is ACTIONABLE — the
 * user can go and complete the task — whereas a state mismatch is terminal
 * for this journey.
 */
function ineligibleBanner(reason) {
  if (reason === 'incomplete-tasks') {
    return {
      type: 'error',
      title: 'Could not approve this determination',
      text: 'Complete every task for this application before approving the determination.'
    }
  }
  return {
    type: 'error',
    text: 'This work item can no longer be approved from its current state.'
  }
}

function detailHref(id) {
  return `/work-items/${encodeURIComponent(id)}`
}

function approveHref(id) {
  return `/work-items/re-accreditation/${encodeURIComponent(id)}/approve`
}

function breadcrumbs(id, ref) {
  return [
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
              { text: id }
            ]
          })
          .code(502)
      }

      const workItem = result.workItem
      const applicationRef = workItem.payload.applicationReference

      // Defensive UX: if the work item is not eligible (the user followed a
      // stale link, the state moved on between page loads, or — RA-346 — a
      // decision task is still pending), redirect back to the detail page
      // rather than letting them submit a request the backend will reject.
      // This guards the ROUTE, not just the CTA: hiding the button is not a
      // control, since the URL is guessable and bookmarkable.
      const eligibility = evaluateApproveEligibility(workItem)
      if (!eligibility.allowed) {
        flashBanner(request, ineligibleBanner(eligibility.reason))
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

      // RA-346. Guard the ROUTE, not just the CTA. Hiding the Approve button
      // is a UX affordance, not a control — this URL is guessable, and a
      // caseworker who bookmarked the interstitial (or replayed the form)
      // must not be able to approve while an `awaiting-decision` task is
      // pending. Re-read the work item so the check runs against current
      // state rather than whatever was true when the page was rendered.
      // Fails CLOSED: if we cannot verify eligibility, we do not approve.
      const current = await getWorkItem({ workItemId: id, user })
      if (!current.ok) {
        logger.warn(
          { workItemId: id, status: current.status },
          'Could not verify re-accreditation approval eligibility'
        )
        flashBanner(request, {
          type: 'error',
          title: 'Could not approve this determination',
          text: 'There was a problem approving this determination. Try again.'
        })
        return h.redirect(detailHref(id))
      }

      const eligibility = evaluateApproveEligibility(current.workItem)
      if (!eligibility.allowed) {
        logger.warn(
          { workItemId: id, reason: eligibility.reason },
          'Blocked re-accreditation approval: work item is not eligible'
        )
        flashBanner(request, ineligibleBanner(eligibility.reason))
        return h.redirect(detailHref(id))
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
  // RA-346. The backend applies its own server-side tasks-complete gate on
  // the approve endpoint. Reaching it means the FE guard and the backend
  // disagreed — most plausibly a task was reopened between our eligibility
  // re-read and the backend's check. Reuse the SAME actionable copy the FE
  // guard uses, so the user is told what to do rather than "try again".
  if (result.outcome === 'tasks-incomplete') {
    return ineligibleBanner('incomplete-tasks')
  }
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
