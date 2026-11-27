/**
 * The in-year change card's site line for an ORS change: the site's name and
 * its ORS id, from the one site management-be stamps on each work item of a
 * type that splits a submission per site (add-ORS, RA-739; ORS update,
 * RA-681).
 *
 * @param {object} payload work item payload
 * @returns {{ name: string|null, reference: string|null }}
 */
export function describeOrsCardSite(payload) {
  const site = payload?.site ?? {}
  return { name: site.siteName ?? null, reference: site.orsId ?? null }
}
