/**
 * Generic code for the Applications list's checkbox filter sections, driven by
 * filter descriptors (see list-filters.js). Each checkbox filter is declared
 * once as a descriptor; everything else (reading the query, the checkbox
 * items, the backend request, the query string of links, the removable chips
 * and the "N selected" counts) is derived from it here.
 *
 * A descriptor:
 *   - `key`: names the filter's selected values (`filters.selected[key]`),
 *     its chips and its section count (`filterCounts[key]`). The section's
 *     id (`filter-section-{id}`, `filter-{id}`) is the key in kebab case.
 *   - `param`: the repeated query-string param (defaults to `key`).
 *   - `title`: the section heading, also its visually hidden legend.
 *   - `options`: `{ value, text, chip? }` in display order. Only these values
 *     are accepted; `chip` is the chip label and defaults to `text`.
 *   - `normalise` (optional): applied to each submitted value before it is
 *     checked against the options.
 *   - `defaultValues` (optional): `({ user, filtersApplied }) => values` used
 *     when no valid value is submitted.
 *   - `toRequest` (optional): `(values) => ({ ...getWorkItems params })`.
 *
 * The order of the descriptors is the order of the params in links and of
 * the chips; the template decides where each section sits on the page.
 */

/**
 * Checkbox (or radio) items for a GOV.UK macro: each option, ticked when its
 * value is selected.
 *
 * @param {{ value: string, text: string }[]} options
 * @param {Iterable<string|null>} selectedValues
 */
export function buildCheckboxOptions(options, selectedValues) {
  const selected = new Set(selectedValues)
  return options.map((o) => ({
    value: o.value,
    text: o.text,
    checked: selected.has(o.value)
  }))
}

/**
 * The trimmed, non-empty, de-duplicated strings of a query value that may be
 * absent, a single string or a repeated param's array.
 */
export function uniqueStringList(value) {
  if (value == null) {
    return []
  }
  const list = Array.isArray(value) ? value : [value]
  const seen = new Set()
  const out = []
  for (const item of list) {
    if (typeof item !== 'string') {
      continue
    }
    const trimmed = item.trim()
    if (trimmed === '' || seen.has(trimmed)) {
      continue
    }
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

function paramOf(descriptor) {
  return descriptor.param ?? descriptor.key
}

/** Every filter's query param. */
export function checkboxFilterParamNames(descriptors) {
  return descriptors.map(paramOf)
}

function sectionId(key) {
  return key.replaceAll(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
}

function readValues(descriptor, query, context) {
  const allowed = new Set(descriptor.options.map((o) => o.value))
  const normalise = descriptor.normalise ?? ((v) => v)
  // De-duplicated again after normalising, so `Plastic` and `plastic` are one.
  const values = [
    ...new Set(uniqueStringList(query[paramOf(descriptor)]).map(normalise))
  ].filter((v) => allowed.has(v))
  if (values.length > 0 || !descriptor.defaultValues) {
    return values
  }
  return descriptor.defaultValues(context)
}

/**
 * Each filter's selected values, keyed by descriptor key. Unknown values are
 * dropped.
 *
 * @param {object[]} descriptors
 * @param {object} query
 * @param {{ user: object|null, filtersApplied: boolean }} context
 * @returns {Record<string, string[]>}
 */
export function readCheckboxFilters(descriptors, query, context) {
  return Object.fromEntries(
    descriptors.map((d) => [d.key, readValues(d, query, context)])
  )
}

/** The getWorkItems params the filters send, merged from each `toRequest`. */
export function checkboxFilterRequest(descriptors, selected) {
  return Object.assign(
    {},
    ...descriptors
      .filter((d) => d.toRequest)
      .map((d) => d.toRequest(selected[d.key]))
  )
}

/** Appends each selected value to `params` under its filter's query param. */
export function appendCheckboxFilterParams(params, descriptors, selected) {
  for (const d of descriptors) {
    for (const value of selected[d.key]) {
      params.append(paramOf(d), value)
    }
  }
}

/** One `{ key, value, label }` chip per selected value. */
export function checkboxFilterChips(descriptors, selected) {
  return descriptors.flatMap((d) => {
    const byValue = new Map(d.options.map((o) => [o.value, o]))
    return selected[d.key].map((value) => {
      const option = byValue.get(value)
      return { key: d.key, value, label: option.chip ?? option.text }
    })
  })
}

/** The number of selected values per filter, keyed by descriptor key. */
export function checkboxFilterCounts(descriptors, selected) {
  return Object.fromEntries(
    descriptors.map((d) => [d.key, selected[d.key].length])
  )
}

/** True when `key` names one of the descriptors. */
export function isCheckboxFilterKey(descriptors, key) {
  return descriptors.some((d) => d.key === key)
}

/** A copy of `selected` with `value` removed from filter `key`. */
export function withoutCheckboxValue(selected, key, value) {
  return { ...selected, [key]: selected[key].filter((v) => v !== value) }
}

/**
 * The template data for each filter's section, keyed by descriptor key:
 * its id, query param, title, selected count and checkbox items.
 */
export function checkboxFilterSections(descriptors, selected) {
  return Object.fromEntries(
    descriptors.map((d) => [
      d.key,
      {
        id: sectionId(d.key),
        name: paramOf(d),
        title: d.title,
        count: selected[d.key].length,
        items: buildCheckboxOptions(d.options, selected[d.key])
      }
    ])
  )
}
