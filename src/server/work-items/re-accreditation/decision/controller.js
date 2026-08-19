/**
 * Re-accreditation log-decision controllers (RA-410).
 *
 * Two handlers — both at `/work-items/re-accreditation/{id}/decision`:
 *
 *  - GET: render the decision page: an Approved / Refused radio group and a
 *    primary submit. Fetches the work item up front so the page can show its
 *    reference and so a stale link cannot reach the form.
 *
 *  - POST: validate that a choice was made, re-check eligibility, then ask
 *    the service to record it. PRG-redirects back to the detail page with a
 *    flash banner in every terminating branch. A missing choice renders the
 *    page again in place with a GOV.UK error summary, which is the one case
 *    that does NOT redirect — the user needs the radio back with their
 *    context intact.
 *
 * Replaces the RA-132 approve interstitial. The `/approve` endpoint still
 * exists backend-side but is no longer reachable from this UI: one page now
 * covers both outcomes, which is the point of the story.
 */

import { getWorkItem } from '#/server/common/helpers/backend-api/backend-api.js'
import { getUser } from '#/server/common/helpers/auth/get-user.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'

import {
  evaluateLogDecisionEligibility,
  isValidDecisionOutcome
} from './eligibility.js'
import { createDecisionService, DECISION_NOTE_MAX_LENGTH } from './service.js'

const VIEW_PATH = 're-accreditation/decision/index'
const NOT_FOUND_VIEW = 'work-items/not-found'
const UNAVAILABLE_VIEW = 'work-items/detail-error'

const PAGE_TITLE = 'Make determination for this application'

// The GOV.UK error-summary link must target the FIRST radio in the group,
// which is the id govuk-frontend generates for the first item — not the
// fieldset. Kept as a constant so the template and the summary cannot drift.
const DECISION_FIELD_ANCHOR = '#decision-approved'
const MISSING_DECISION_MESSAGE = 'Select the decision for this application'

// RA-203. The note's own anchor. `govukCharacterCount` renders its textarea
// with this id, and mgmt-tests selects on it too — treat it as contract.
const NOTE_FIELD_ANCHOR = '#field-decisionNote'
const NOTE_TOO_LONG_MESSAGE = `Decision note must be ${DECISION_NOTE_MAX_LENGTH} characters or fewer`

const logger = createLogger()

/**
 * Banner for a decision that is not (or is no longer) permitted.
 *
 * `reason` is the code from `evaluateLogDecisionEligibility`. `terminal-state`
 * gets its own copy because "already decided" is a genuinely different thing
 * from "not at that stage yet", and the user's next step differs: one means
 * look at the outcome, the other means finish the assessment.
 */
function ineligibleBanner(reason) {
  if (reason === 'terminal-state') {
    return {
      type: 'error',
      title: 'Could not log a decision',
      text: 'A decision has already been recorded for this application.'
    }
  }
  return {
    type: 'error',
    title: 'Could not log a decision',
    text: 'A decision cannot be logged for this application from its current state.'
  }
}

function detailHref(id) {
  return `/work-items/${encodeURIComponent(id)}`
}

function decisionHref(id) {
  return `/work-items/re-accreditation/${encodeURIComponent(id)}/decision`
}

function breadcrumbs(id, ref) {
  return [
    { text: 'Work items', href: '/work-items' },
    { text: ref ?? 'Work item', href: detailHref(id) },
    { text: 'Log decision' }
  ]
}

function flashBanner(request, banner) {
  request.yar?.flash?.('flashBanner', banner)
}

function renderNotFound(h, id) {
  return h
    .view(NOT_FOUND_VIEW, {
      pageTitle: 'Application not found',
      heading: 'Application not found',
      workItemId: id,
      breadcrumbs: [
        { text: 'Applications', href: '/work-items' },
        { text: 'Not found' }
      ]
    })
    .code(404)
}

function renderUnavailable(h, id, result) {
  return h
    .view(UNAVAILABLE_VIEW, {
      pageTitle: 'Work item unavailable',
      heading: 'Work item unavailable',
      workItemId: id,
      error: result.error ?? `Backend returned ${result.status}`,
      breadcrumbs: [{ text: 'Work items', href: '/work-items' }, { text: id }]
    })
    .code(502)
}

/**
 * GET — render the Approved / Refused radio page.
 */
export function makeShowDecisionController() {
  return {
    async handler(request, h) {
      const id = request.params.id
      const user = getUser(request)
      const result = await getWorkItem({ workItemId: id, user })

      if (result.ok === false && result.status === 404) {
        return renderNotFound(h, id)
      }
      if (!result.ok) {
        return renderUnavailable(h, id, result)
      }

      const workItem = result.workItem
      const applicationRef = workItem.payload?.applicationReference

      // Guard the ROUTE, not just the CTA. Hiding the button is a UX
      // affordance, not a control — this URL is guessable and bookmarkable,
      // and the state may have moved on since the detail page was rendered.
      const eligibility = evaluateLogDecisionEligibility(workItem)
      if (!eligibility.allowed) {
        flashBanner(request, ineligibleBanner(eligibility.reason))
        return h.redirect(detailHref(id))
      }

      return h.view(VIEW_PATH, {
        pageTitle: PAGE_TITLE,
        heading: PAGE_TITLE,
        breadcrumbs: breadcrumbs(id, applicationRef),
        workItem: { ...workItem, applicationRef },
        formAction: decisionHref(id),
        cancelHref: detailHref(id),
        values: { decision: null, decisionNote: '' },
        decisionNoteMaxLength: DECISION_NOTE_MAX_LENGTH,
        errorSummary: null,
        fieldErrors: {}
      })
    }
  }
}

/**
 * POST — record the decision. PRG-redirects in every branch except a
 * missing/invalid choice, which re-renders the form with an error summary.
 */
export function makeSubmitDecisionController({
  service = createDecisionService()
} = {}) {
  return {
    async handler(request, h) {
      const id = request.params.id
      const user = getUser(request)
      const payload = request.payload ?? {}
      const decision = payload.decision
      const decisionNote =
        typeof payload.decisionNote === 'string' ? payload.decisionNote : ''

      // Re-read the work item before doing anything else. Needed for BOTH
      // the validation re-render (the page shows the application reference)
      // and the eligibility re-check, so it is fetched once up front rather
      // than twice down two branches. Fails CLOSED.
      const current = await getWorkItem({ workItemId: id, user })
      if (current.ok === false && current.status === 404) {
        return renderNotFound(h, id)
      }
      if (!current.ok) {
        logger.warn(
          { workItemId: id, status: current.status },
          'Could not verify re-accreditation decision eligibility'
        )
        flashBanner(request, {
          type: 'error',
          title: 'Could not log a decision',
          text: 'There was a problem recording this decision. Try again.'
        })
        return h.redirect(detailHref(id))
      }

      const workItem = current.workItem
      const applicationRef = workItem.payload?.applicationReference

      // Validate EVERY field before rendering, then show all the errors at
      // once. Returning on the first failure would make a user who missed the
      // radio AND over-ran the note fix one, resubmit, and be told about the
      // other — the pattern GDS error summaries exist to avoid.
      //
      // Summary items are pushed in the order the fields appear on the page,
      // because the summary's links are a navigation aid: listing them out of
      // visual order sends the user backwards up the form.
      const fieldErrors = {}
      const errorItems = []

      if (!isValidDecisionOutcome(decision)) {
        fieldErrors.decision = MISSING_DECISION_MESSAGE
        errorItems.push({
          text: MISSING_DECISION_MESSAGE,
          href: DECISION_FIELD_ANCHOR
        })
      }

      // RA-203. Checked HERE, not left to the service, because this is a form
      // error and needs to render in place against the field. The service
      // keeps its own identical guard as a backstop for non-form callers, but
      // its failure result is a banner-and-redirect — which for an over-long
      // note would bounce the user to the detail page and discard the
      // rationale they had just written.
      //
      // ⚠ This is the ONLY thing enforcing the limit, in every browser — not
      // just the no-JS case RA-94 mandates. `govukCharacterCount` passes
      // `maxlength` to `data-maxlength` and deliberately never sets the HTML
      // `maxlength` attribute (see govuk-frontend's own
      // `character-count/template.njk`), so the textarea accepts unlimited
      // input regardless. With JS the counter turns red and says how far over
      // you are; it does not block submission. Verified against the installed
      // govuk-frontend by mgmt-tests, which asserts this path end-to-end.
      if (decisionNote.trim().length > DECISION_NOTE_MAX_LENGTH) {
        fieldErrors.decisionNote = NOTE_TOO_LONG_MESSAGE
        errorItems.push({
          text: NOTE_TOO_LONG_MESSAGE,
          href: NOTE_FIELD_ANCHOR
        })
      }

      // Render in place — a redirect would lose the form and the user would
      // have to find their way back.
      if (errorItems.length > 0) {
        return h
          .view(VIEW_PATH, {
            pageTitle: `Error: ${PAGE_TITLE}`,
            heading: PAGE_TITLE,
            breadcrumbs: breadcrumbs(id, applicationRef),
            workItem: { ...workItem, applicationRef },
            formAction: decisionHref(id),
            cancelHref: detailHref(id),
            decisionNoteMaxLength: DECISION_NOTE_MAX_LENGTH,
            // The decision itself is deliberately NOT echoed back: an invalid
            // value is either a missing choice (nothing to echo) or a forged
            // one (must not be reflected into the page), so the radios render
            // unset. The NOTE is echoed — it is the user's own prose, and
            // discarding it because they missed a radio, or because it ran
            // long, would destroy the very thing they need to edit. Nunjucks
            // auto-escapes it on the way out.
            values: {
              decision: isValidDecisionOutcome(decision) ? decision : null,
              decisionNote
            },
            errorSummary: {
              titleText: 'There is a problem',
              items: errorItems
            },
            fieldErrors
          })
          .code(400)
      }

      // Guard the ROUTE. Same reasoning as the GET, but re-evaluated against
      // the state we just read rather than whatever was true when the page
      // was rendered — a replayed form must not decide an application twice.
      const eligibility = evaluateLogDecisionEligibility(workItem)
      if (!eligibility.allowed) {
        logger.warn(
          { workItemId: id, reason: eligibility.reason },
          'Blocked re-accreditation decision: work item is not eligible'
        )
        flashBanner(request, ineligibleBanner(eligibility.reason))
        return h.redirect(detailHref(id))
      }

      const result = await service.recordWorkItemDecision({
        workItemId: id,
        outcome: decision,
        decisionNote,
        user
      })

      if (result.ok) {
        flashBanner(request, successBannerFor(decision))
        return h.redirect(detailHref(id))
      }

      // Log every non-success outcome so an unexpected 5xx still leaves a
      // breadcrumb even though the user only sees a generic banner.
      logger.warn(
        {
          workItemId: id,
          decision,
          outcome: result.outcome,
          status: result.status,
          message: result.message
        },
        'Re-accreditation decision failed'
      )
      flashBanner(request, bannerForFailure(result))
      return h.redirect(detailHref(id))
    }
  }
}

/**
 * Success copy. The only place the user-visible word for `rejected` appears
 * outside the radio label — and it says "Refused", per the RA-410 relabel.
 */
function successBannerFor(decision) {
  if (decision === 'approved') {
    return {
      type: 'success',
      title: 'Decision logged: Approved',
      text: 'The accreditation has been issued and the applicant will be notified.'
    }
  }
  return {
    type: 'success',
    title: 'Decision logged: Refused',
    text: 'The application has been refused and the applicant will be notified.'
  }
}

function bannerForFailure(result) {
  // RA-203. Distinct copy because the user's next step differs: nothing was
  // decided, and the reason is their note rather than the case. Saying "try
  // again" alone would leave them unsure whether the decision landed.
  if (result.outcome === 'note-failed') {
    return {
      type: 'error',
      title: 'Could not save the decision note',
      text:
        result.message ??
        'Your decision note could not be saved, so the decision was not recorded. Try again.'
    }
  }
  if (result.outcome === 'conflict') {
    return {
      type: 'error',
      title: 'Could not log a decision',
      text: 'This application has changed since you opened it. Refresh and try again.'
    }
  }
  return {
    type: 'error',
    title: 'Could not log a decision',
    text: 'There was a problem recording this decision. Try again.'
  }
}
