/**
 * The in-year change card's site line for an ORS case (add-ORS, RA-739; ORS
 * update, RA-782): the site's name and its ORS id, from the one site
 * management-be stamps on each work item. In core, as both modules use it
 * and no module depends on another.
 *
 * @param {object} payload work item payload
 * @returns {{ name: string|null, reference: string|null }}
 */
export function describeCardSite(payload) {
  const site = payload?.site ?? {}
  return { name: site.siteName ?? null, reference: site.orsId ?? null }
}
