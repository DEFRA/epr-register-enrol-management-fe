// RA-245. Site address formatting helpers.
//
// A re-accreditation work item's site address arrives in one of two shapes
// depending on how the item was created:
//
//   - Form-created items store a nested object
//     `payload.siteAddress = { line1, line2, town, postcode }` (line2
//     optional, no county) with the postcode nested inside it.
//   - Legacy / seeded items store a flat string `payload.siteAddress`
//     ("1 Main St, Leeds, LS1 1AB") plus a flat `payload.siteAddressPostcode`.
//
// These pure helpers normalise both shapes for display. They never throw on
// null / undefined / unexpected input, and they return `null` (not the
// em-dash) when there is nothing to show so callers own the fallback.

// Coerce a value to a trimmed string, or null when it is blank / not a
// primitive string-able value.
function toTrimmedString(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed === '' ? null : trimmed
  }
  return null
}

// Build the single-line site address for display, excluding the postcode
// (which has its own summary row). Returns null when nothing is present.
export function formatSiteAddress(payload) {
  const siteAddress = payload?.siteAddress
  if (siteAddress == null) return null

  // Legacy flat string shape.
  if (typeof siteAddress === 'string') {
    return toTrimmedString(siteAddress)
  }

  // Nested object shape. Anything that is not an object we can index has
  // nothing to offer.
  if (typeof siteAddress !== 'object') return null

  const parts = [siteAddress.line1, siteAddress.line2, siteAddress.town]
    .map(toTrimmedString)
    .filter((part) => part !== null)

  return parts.length > 0 ? parts.join(', ') : null
}

// Resolve the site postcode, preferring the nested object's postcode over the
// flat legacy field. Returns the trimmed string, or null when absent / blank.
export function getSitePostcode(payload) {
  const siteAddress = payload?.siteAddress
  if (siteAddress != null && typeof siteAddress === 'object') {
    const nested = toTrimmedString(siteAddress.postcode)
    if (nested !== null) return nested
  }
  return toTrimmedString(payload?.siteAddressPostcode)
}
