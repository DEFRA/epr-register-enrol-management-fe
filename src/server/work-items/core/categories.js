/**
 * RA-739. The categories a work item type can declare through its `category`,
 * mirroring management-be's `WorkItemCategories`. A category groups related
 * types; a type with no category (re-accreditation) is its own group.
 */

/** In-year changes to an accreditation (add-ORS now; more later). */
export const IN_YEAR_CHANGE_CATEGORY = 'in-year-change'

/**
 * Is the work item type an in-year change?
 *
 * @param {{ category?: string } | null | undefined} type
 * @returns {boolean}
 */
export function isInYearChangeType(type) {
  return type?.category === IN_YEAR_CHANGE_CATEGORY
}
