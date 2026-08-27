/**
 * Overseas reprocessing site (ORS) reader — the single place case
 * management decides which of a submitted payload's overseas sites are
 * still part of the application.
 *
 * RA-483. In the operator journey, "removing" an ORS is a DESELECT, not a
 * delete: the row stays in `payload.overseasSites.sites` and only the
 * legacy backend's `OverseasSiteModel.Selected` flag flips to `false`. The
 * case-working payload builder used to project every site unfiltered and
 * never emitted the flag, so a site the operator had removed (the reported
 * case: a German ORS) still showed up here — with nothing to say it was
 * gone — risking it being added to the accreditation. That producer is
 * being fixed to filter and to emit `selected`; this is the renderer's own
 * defence, at the point of display, which is where the AC is written, so
 * payloads submitted BEFORE that fix are handled too.
 *
 * Please do not "simplify" this into a plain array read. It looks
 * redundant once the producer filters, and it is not: already-submitted
 * work items keep whatever their payload was stamped with at submission.
 *
 * Semantics, fixed by the cross-repo contract — do not widen them:
 *
 *   - `selected` absent  -> VISIBLE. Every work item submitted before the
 *     flag existed has no such field, and those sites must still render.
 *   - `selected === true` -> VISIBLE.
 *   - explicit `false`   -> REMOVED. Never rendered, never actionable.
 *
 * A missing flag is therefore NOT removal; only an explicit `false` is.
 */

/**
 * @param {object} site an element of `payload.overseasSites.sites`
 * @returns {boolean} false only when the operator has deselected the site
 */
export function isSiteSelected(site) {
  return site?.selected !== false
}

/**
 * The application's overseas sites, with operator-removed ones excluded.
 *
 * @param {object} workItem decorated work item
 * @returns {object[]} the still-selected sites, in payload order
 */
export function overseasSitesOf(workItem) {
  const sites = workItem?.payload?.overseasSites?.sites
  return Array.isArray(sites) ? sites.filter(isSiteSelected) : []
}
