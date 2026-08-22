/**
 * Extract a plain ISO-8601 string from a value that is either already a
 * string or the Mongo relaxed extended-JSON `{ "$date": "ISO-8601" }` shape
 * the backend serialises `BsonDateTime` values as.
 *
 * The two shapes are both live on the wire: a value written by a real
 * operator submission arrives as a plain JSON string, whereas one written as
 * a native `DateTime` round-trips through the API as `{ $date: '...' }`.
 * Every date the UI formats has to tolerate both, so the unwrapping lives
 * here rather than being re-implemented per controller (RA-295).
 *
 * @param {unknown} value
 * @returns {string|null} the ISO string, or null for absent / unexpected shapes.
 */
export function unwrapMongoDate(value) {
  if (!value) {
    return null
  }
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'object' && typeof value.$date === 'string') {
    return value.$date
  }
  return null
}
