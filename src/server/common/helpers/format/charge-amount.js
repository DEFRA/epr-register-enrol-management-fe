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
  if (typeof pence !== 'number' || !Number.isInteger(pence)) {
    return null
  }
  const hasFraction = pence % 100 !== 0
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: hasFraction ? 2 : 0
  }).format(pence / 100)
}
