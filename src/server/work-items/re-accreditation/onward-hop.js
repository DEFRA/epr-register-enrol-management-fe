/**
 * Shared machinery for re-accreditation's "onward hop" flows (RA-523).
 *
 * Two flows now carry an application forward out of `updated`, and they are
 * structurally identical: Continue review (RA-372) and Payment received
 * (RA-523). Both are body-less, single-step POSTs to a type-specific
 * endpoint whose target state the backend resolves; both PRG-redirect to
 * the detail page with a flash banner; both branch on the same outcome
 * vocabulary.
 *
 * RA-523 originally shipped the second flow as a near-copy of the first.
 * That was the wrong instinct and SonarCloud's duplication gate caught it:
 * a second copy means a fix to the redirect, the logging or the outcome
 * mapping has to be made twice, and the day it is made once is the day the
 * two silently diverge. The differences between the flows are entirely
 * DATA — an endpoint, a method name, four strings — so they are expressed
 * as data here and the behaviour lives once.
 *
 * Deliberately in `re-accreditation/` rather than `work-items/core/`: this
 * is not framework behaviour, it is a shape two flows of THIS type happen
 * to share. Promoting it to core would invite other modules to inherit a
 * convention nobody has asked for. See `docs/work-items.md` — shared
 * behaviour is lifted when it is genuinely cross-type, not when two
 * siblings rhyme.
 */

import { getUser } from '#/server/common/helpers/auth/get-user.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'

import { toOutcome } from '../core/backend-outcome.js'

const logger = createLogger()

/**
 * Build the one method an onward-hop service exposes.
 *
 * Callers wrap this in their own intent-named method (RA-90 requires the
 * intent to be readable at the call site — `continueReviewOfWorkItem`,
 * `recordPaymentReceived`), so this returns the FUNCTION rather than an
 * object: the naming stays with the flow that owns it.
 *
 * @param {object} args
 * @param {Function} args.call Backend client call, `({ workItemId, user })`.
 * @param {string} args.failureMessage Fallback when the backend sends none.
 */
export function createOnwardHopCall({ call, failureMessage }) {
  return async function apply({ workItemId, user = null }) {
    if (typeof workItemId !== 'string' || workItemId.trim() === '') {
      throw new Error('workItemId must be a non-empty string')
    }

    const result = await call({ workItemId, user })

    if (result.ok) {
      return { ok: true, workItem: result.workItem }
    }

    return {
      ok: false,
      outcome: toOutcome(result.reason),
      status: result.status,
      message: result.message ?? failureMessage
    }
  }
}

function detailHref(id) {
  return `/work-items/${encodeURIComponent(id)}`
}

/**
 * Build the POST handler for an onward-hop flow.
 *
 * Every branch PRG-redirects to the detail page, so a refresh never
 * re-posts and the caller always lands on the page showing the
 * (backend-resolved) new state — including on failure, where a dead-end
 * error page would lose them the item they were working on.
 *
 * @param {object} args
 * @param {Function} args.apply The service method to invoke.
 * @param {object} args.banners `{ success, failureTitle, conflict, notFound, fallback }`
 *   — the flow's own copy. Text only; the shapes are built here.
 * @param {string} args.logMessage Warning line for a non-success outcome.
 */
export function makeOnwardHopHandler({ apply, banners, logMessage }) {
  return async function handler(request, h) {
    const id = request.params.id
    const user = getUser(request)

    const result = await apply({ workItemId: id, user })

    if (result.ok) {
      request.yar?.flash?.('flashBanner', banners.success)
      return h.redirect(detailHref(id))
    }

    // Log every non-success outcome so an unexpected 5xx still leaves a
    // breadcrumb even though the user only sees a generic banner.
    logger.warn(
      {
        workItemId: id,
        outcome: result.outcome,
        status: result.status,
        message: result.message
      },
      logMessage
    )
    request.yar?.flash?.('flashBanner', bannerForFailure(result, banners))
    return h.redirect(detailHref(id))
  }
}

function bannerForFailure(result, banners) {
  const text =
    {
      conflict: banners.conflict,
      'not-found': banners.notFound
    }[result.outcome] ?? banners.fallback

  return { type: 'error', title: banners.failureTitle, text }
}
