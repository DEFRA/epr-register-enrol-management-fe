import { ADD_OVERSEAS_SITE_TYPE_ID } from '#/server/work-items/add-overseas-site/type-id.js'
import {
  canQueryWorkItem,
  isContinueReviewState,
  isPreDulyMadeWaypoint
} from '#/server/routes/work-items/re-accreditation-cta.js'

/**
 * RA-698. The add-ORS detail page's query affordances, layered onto the
 * decorated work item as re-accreditation's view model does for its own:
 *
 *  - `canQuery`: the "Raise a query" CTA, in submitted, duly-made and
 *    assessment (the Standard workflow's `query-during-*` states).
 *  - `canContinueReview` + `continueReviewHref`: the CTA out of `updated`,
 *    once the operator has answered. Not offered for an item queried before
 *    it was duly made (RA-454): Duly make is the only way on there.
 *
 * Both read the RAW backend DTO (`source`), as the routes do, so a button
 * never disagrees with the URL behind it. Any other type is returned as is.
 */
export function applyAddOverseasSiteViewModel({
  workItem,
  source = workItem,
  route
}) {
  if (workItem.typeId !== ADD_OVERSEAS_SITE_TYPE_ID) {
    return workItem
  }
  return {
    ...workItem,
    canQuery: canQueryWorkItem(source, { route }),
    queryHref: `/work-items/${encodeURIComponent(workItem.id)}/query`,
    canContinueReview:
      isContinueReviewState(source?.stateId) &&
      !isPreDulyMadeWaypoint(source?.originStateId),
    continueReviewHref: `/work-items/${ADD_OVERSEAS_SITE_TYPE_ID}/${encodeURIComponent(workItem.id)}/continue-review`
  }
}
