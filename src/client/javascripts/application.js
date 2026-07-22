import {
  createAll,
  Button,
  CharacterCount,
  Checkboxes,
  ErrorSummary,
  Radios,
  ServiceNavigation,
  SkipLink
} from 'govuk-frontend'

createAll(Button)
// RA-291: powers the live "You have N words remaining" count on the
// query form's reason field. Progressive enhancement only — the word
// limit is enforced server-side.
createAll(CharacterCount)
createAll(Checkboxes)
createAll(ErrorSummary)
createAll(Radios)
createAll(ServiceNavigation)
createAll(SkipLink)
