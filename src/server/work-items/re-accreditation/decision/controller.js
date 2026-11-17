/**
 * Re-accreditation log-decision controllers (RA-410): the shared
 * Standard-lifecycle controllers (RA-495), scoped to re-accreditation and
 * posting to its own endpoint.
 */

import {
  makeShowDecisionController as makeShowStandardDecisionController,
  makeSubmitDecisionController as makeSubmitStandardDecisionController
} from '../../core/standard-lifecycle/decision/controller.js'
import { RE_ACCREDITATION_TYPE_ID } from '../type-id.js'
import { createDecisionService } from './service.js'

export function makeShowDecisionController() {
  return makeShowStandardDecisionController({
    typeId: RE_ACCREDITATION_TYPE_ID
  })
}

export function makeSubmitDecisionController({
  service = createDecisionService()
} = {}) {
  return makeSubmitStandardDecisionController({
    typeId: RE_ACCREDITATION_TYPE_ID,
    service
  })
}
