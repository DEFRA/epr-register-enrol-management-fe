/**
 * The shared reading of a three-box `govukDateInput` (day, month, year) for
 * the Standard-lifecycle pages: the payment date at duly making and the
 * effective date at make determination (RA-495 AC6). Each page adds its own
 * range rules and copy on top.
 */

function textOf(value) {
  return value == null ? '' : String(value).trim()
}

function pad(value, length) {
  return String(value).padStart(length, '0')
}

/**
 * Read the three boxes into the backend's wire format.
 *
 * A PARTIALLY filled date is `invalid`, not a per-part message: each page's
 * error codes are a contract shared with management-be, which has no
 * per-part wording either.
 *
 * @param {{ day?: string, month?: string, year?: string }} values
 * @returns {{ ok: true, value: string, utcTime: number } | { ok: false, error: 'required' | 'invalid' }}
 *   `value` is a plain `YYYY-MM-DD` string (management-be parses an exact
 *   `yyyy-MM-dd` and rejects a timestamp); `utcTime` is that date's UTC
 *   midnight, for range checks.
 */
export function readDateInput(values) {
  const day = textOf(values?.day)
  const month = textOf(values?.month)
  const year = textOf(values?.year)

  if (day === '' && month === '' && year === '') {
    return { ok: false, error: 'required' }
  }

  if (
    !/^\d{1,2}$/.test(day) ||
    !/^\d{1,2}$/.test(month) ||
    !/^\d{4}$/.test(year)
  ) {
    return { ok: false, error: 'invalid' }
  }

  const d = Number(day)
  const m = Number(month)
  const y = Number(year)

  const asUtc = new Date(Date.UTC(y, m - 1, d))
  // Round-trip check. `Date.UTC` happily rolls 2026-02-30 forward into
  // March, so comparing the parts back is what actually rejects an unreal
  // date — a range check on d/m alone would let it through.
  if (
    asUtc.getUTCFullYear() !== y ||
    asUtc.getUTCMonth() !== m - 1 ||
    asUtc.getUTCDate() !== d
  ) {
    return { ok: false, error: 'invalid' }
  }

  return {
    ok: true,
    value: `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`,
    utcTime: asUtc.getTime()
  }
}
