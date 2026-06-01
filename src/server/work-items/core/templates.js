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
  if (!detailTemplatesByVersion) return
  for (const [version, path] of Object.entries(detailTemplatesByVersion)) {
    registerDetailTemplate(typeId, version, path)
  }
}

/** Remove every registered template. Intended for tests. */
export function clearDetailTemplateRegistry() {
  templates.clear()
}
