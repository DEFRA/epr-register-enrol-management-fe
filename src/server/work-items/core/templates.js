/**
 * Registry of detail templates keyed by `(typeId, templateVersion)`.
 *
 * Modules register one detail template per template version they ship; the
 * detail controller picks the template matching a work item's stored
 * `templateVersion`, so historical work items continue to render with the
 * same template they were assessed against — even after a module rolls out
 * a new template version.
 *
 * Falling back to the generic core template (`work-items/detail.njk`) keeps
 * brand-new types and legacy items from ever showing nothing at all.
 */

const templates = new Map()

const DEFAULT_TEMPLATE_PATH = 'work-items/detail'

function key(typeId, version) {
  return `${typeId}::${version}`
}

/**
 * Register a detail template for a specific type and template version.
 * @param {string} typeId          Work item type id (e.g. "re-accreditation").
 * @param {string} templateVersion Version stamped on the work item at submission.
 * @param {string} templatePath    Nunjucks template path to render.
 */
export function registerDetailTemplate(typeId, templateVersion, templatePath) {
  if (typeof typeId !== 'string' || typeId.trim() === '') {
    throw new Error('Detail template typeId must be a non-empty string')
  }
  if (typeof templateVersion !== 'string' || templateVersion.trim() === '') {
    throw new Error(
      `Detail template for "${typeId}" must declare a non-empty templateVersion`
    )
  }
  if (typeof templatePath !== 'string' || templatePath.trim() === '') {
    throw new Error(
      `Detail template for "${typeId}" version "${templateVersion}" must be a non-empty string`
    )
  }
  templates.set(key(typeId, templateVersion), templatePath)
}

/**
 * Resolve the detail template for a work item. Returns the registered template
 * for `(typeId, templateVersion)` if present, otherwise the generic fallback
 * so unknown types or pre-versioning legacy items still render.
 */
export function resolveDetailTemplate(typeId, templateVersion) {
  if (typeId && templateVersion) {
    const path = templates.get(key(typeId, templateVersion))
    if (path) {
      return path
    }
  }
  return DEFAULT_TEMPLATE_PATH
}

/**
 * Helper for module `register` callbacks that ship a `templates.detail` map
 * keyed by version. Lets a module declare every shipped template version in
 * one place and have them all registered at boot.
 */
export function registerModuleDetailTemplates(
  typeId,
  detailTemplatesByVersion
) {
  if (!detailTemplatesByVersion) {
    return
  }
  for (const [version, path] of Object.entries(detailTemplatesByVersion)) {
    registerDetailTemplate(typeId, version, path)
  }
}

/** Remove every registered template. Intended for tests. */
export function clearDetailTemplateRegistry() {
  templates.clear()
}

/**
 * Boot-time guard against the "bumped templateVersion but forgot the
 * registry entry" class of bug (RA-291, and its recurrence at v7/v8):
 * `resolveDetailTemplate` fails *silently*, falling back to the generic
 * template with no error anywhere, so nothing else catches this until
 * someone notices missing UI in production.
 *
 * If a type has registered at least one detail template, its currently
 * declared `templateVersion` must be one of them. Types that never
 * register a detail template at all (relying entirely on the generic
 * fallback) are exempt — that is a deliberate, supported choice, not
 * drift.
 */
export function assertCurrentTemplateVersionIsRegistered(
  typeId,
  templateVersion
) {
  const prefix = `${typeId}::`
  const hasAnyRegisteredTemplate = Array.from(templates.keys()).some((k) =>
    k.startsWith(prefix)
  )
  if (!hasAnyRegisteredTemplate) {
    return
  }
  if (!templates.has(key(typeId, templateVersion))) {
    throw new Error(
      `Work item type "${typeId}" declares templateVersion "${templateVersion}" ` +
        'but no detail template is registered for it. Add an entry to its ' +
        'registerModuleDetailTemplates(...) call — an unregistered version ' +
        'silently falls back to the generic detail template.'
    )
  }
}
