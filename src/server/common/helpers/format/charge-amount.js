// Lifted out of the re-accreditation duly-making module (RA-493) so the
// generic case header can format the charge without a route depending on a
// work item module.

/**
 * Format an integer minor-unit amount as GBP.
 *
 * `chargeAmountPence` arrives in PENCE — £3,276.00 is `327600`. Getting this
 * wrong is a silent factor-of-100 error on a financial screen, so the
 * units are asserted in the tests rather than trusted.
 *
 * Always two decimals, whole pounds included ("£3,276.00", "£3,276.50"),
 * so every charge on a case reads the same way (user decision 2026-11-18).
 *
 * @returns {string|null} `null` when the amount is absent or not an
 *   integer — the caller decides how to degrade. Note `0` is a LEGITIMATE
 *   amount and formats as "£0.00"; it must never be confused with absent.
 */
export function formatChargeAmount(pence) {
  if (!isPence(pence)) {
    return null
  }
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(pence / 100)
}

function isPence(value) {
  return typeof value === 'number' && Number.isInteger(value)
}
