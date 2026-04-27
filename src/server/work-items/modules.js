/**
 * The list of work item modules registered with the application.
 *
 * To add a new work item type:
 *   1. Create a folder under `src/server/work-items/<type-id>/`
 *   2. Implement `module.js` exporting the work item module contract
 *      (see docs/work-items.md and src/server/work-items/core/module.js)
 *   3. Import that module here and append it to the array below.
 *
 * No other core code needs to change.
 */

import { reAccreditationModule } from './re-accreditation/module.js'

export const workItemModules = [reAccreditationModule]
