import {
  createReAccreditationSchema,
  joiDetailsToFieldErrors
} from './schema.js'

/**
 * Lazily resolve the default backend client. Importing it dynamically
 * (rather than at the top of this module) means existing test suites
 * that fully mock `backend-api.js` without listing `createWorkItem` in
 * their factory still load successfully — vitest's strict mock proxy
 * only fires when this getter is actually invoked, which happens only
 * when no `createWorkItem` is injected into `createReAccreditationService`.
 */
async function defaultCreateWorkItem(args) {
  const mod = await import('#/server/common/helpers/backend-api/backend-api.js')
  return mod.createWorkItem(args)
}

/**
 * Re-accreditation create service (RA-127).
 *
 * Validates the form payload with Joi and forwards a successfully
 * validated submission to the backend client. Returns a typed result
 * object so the controller can branch declaratively without parsing HTTP
 * status codes.
 *
 * Result shape:
 *  - { ok: true, workItem, applicationReference }  on success
 *  - { ok: false, reason: 'invalid', fieldErrors, values }  on Joi failure
 *  - { ok: false, reason: 'invalid' | 'unauthorized' | 'forbidden' | 'server' | 'network',
 *      message, status?, fieldErrors?, values }   on backend rejection
 *
 * `values` always carries the trimmed-but-otherwise-untouched form input
 * back to the template so the user does not have to retype on a failed
 * submission.
 */
export function createReAccreditationService({
  createWorkItem = defaultCreateWorkItem
} = {}) {
  return {
    async create({ formValues, user }) {
      const { error, value } = createReAccreditationSchema.validate(
        formValues ?? {},
        { abortEarly: false, stripUnknown: true, convert: true }
      )

      if (error) {
        return {
          ok: false,
          reason: 'invalid',
          fieldErrors: joiDetailsToFieldErrors(error.details),
          values: formValues ?? {}
        }
      }

      const result = await createWorkItem({
        typeId: 're-accreditation',
        payload: value,
        applicationReference: value.applicationReference,
        source: 're-accreditation-journey',
        user
      })

      if (result.ok) {
        return {
          ok: true,
          workItem: result.workItem,
          applicationReference: value.applicationReference
        }
      }

      return {
        ...result,
        values: formValues ?? {}
      }
    }
  }
}
