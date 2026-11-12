// Lifted out of the re-accreditation duly-making module (RA-493) so the
// generic case header can format the charge without a route depending on a
// work item module. Behaviour is unchanged.

/**
 * Format an integer minor-unit amount as GBP.
 *
 * `chargeAmountPence` arrives in PENCE — £3,276 is `327600`. Getting this
 * wrong is a silent factor-of-100 error on a financial screen, so the
 * units are asserted in the tests rather than trusted.
 *
 * Whole pounds render without decimals ("£3,276") to match the design;
 * a part-pound amount keeps both ("£3,276.50").
 *
 * @returns {string|null} `null` when the amount is absent or not an
 *   integer — the caller decides how to degrade. Note `0` is a LEGITIMATE
 *   amount and formats as "£0"; it must never be confused with absent.
 */
export function formatChargeAmount(pence) {
  if (!isPence(pence)) {
    return null
  }
  return formatPounds(pence, pence % 100 === 0 ? 0 : 2)
}

function isPence(value) {
  return typeof value === 'number' && Number.isInteger(value)
}

function formatPounds(pence, fractionDigits) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits
  }).format(pence / 100)
}
