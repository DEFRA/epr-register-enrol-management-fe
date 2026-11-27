/**
 * RA-681. The label naming a work item's request type, as the Applications
 * list card ("Request type:"), the case header ("Application type"), the
 * Related change requests tab and the audit log "Type" row show it.
 *
 * A type can work its label out from the work item's own payload with an
 * optional `describeRequestType(payload)`, e.g. an ORS change prefixed
 * "Accreditation:" or "Registration:" from the site's `selected` flag. When
 * it has none, or it gives no label for this payload, the type's fixed
 * `displayName` is the label.
 *
 * @param {object|null} type the registered work item type
 * @param {object} [payload] the work item's payload
 * @returns {string|null} null when there is no type
 */
export function requestTypeLabel(type, payload) {
  if (!type) {
    return null
  }
  return type.describeRequestType?.(payload) || type.displayName
}
