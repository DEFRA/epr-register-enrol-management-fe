/**
 * Word counting shared between the server-side validators and any
 * template that needs to display a count (RA-291).
 *
 * The algorithm is deliberately trivial and mirrors the backend's: trim
 * the input, split on runs of whitespace, and count the non-empty tokens.
 * Anything cleverer (punctuation stripping, hyphen splitting, unicode
 * segmentation) would drift from the backend and let a submission pass one
 * validator and fail the other.
 *
 * Not literally byte-for-byte with the backend at the margins: JS `\s` and
 * .NET's `char.IsWhiteSpace` disagree on a few exotic code points (e.g.
 * U+0085 NEL, U+FEFF). This is immaterial in practice — the backend is the
 * authoritative validator, and this count is only a client-side display and
 * a first-line guard.
 */
export function countWords(value) {
  if (typeof value !== 'string') return 0
  const trimmed = value.trim()
  if (trimmed === '') return 0
  return trimmed.split(/\s+/).filter((token) => token !== '').length
}
