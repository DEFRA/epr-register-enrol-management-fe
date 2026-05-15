/**
 * Single source of truth for "is this task complete?" so the detail and
 * tasks controllers (RA-129 review point 4) cannot drift apart if the
 * heuristic is ever extended (e.g. a new lifecycle status is added).
 *
 * Treats the canonical `status === 'Completed'` as authoritative and
 * falls back to the legacy `isComplete: true` boolean only when the
 * status field is absent — matching the behaviour pre epr-gl6 backends
 * still emit through historical fixtures.
 */
export function isTaskComplete(task) {
  if (task == null) return false
  if (task.status === 'Completed') return true
  if (task.status == null && task.isComplete === true) return true
  return false
}
