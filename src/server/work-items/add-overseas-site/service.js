async function defaultOperation(args) {
  const backend =
    await import('#/server/common/helpers/backend-api/backend-api.js')
  return backend.performAddOverseasSiteOperation(args)
}

export function createAddOverseasSiteActionsService({
  performOperation = defaultOperation
} = {}) {
  async function perform(operation, { workItemId, user = null }) {
    const result = await performOperation({ workItemId, operation, user })
    if (result.ok) {
      return { ok: true, workItem: result.workItem }
    }
    return {
      ok: false,
      outcome: result.status === 503 ? 'delivery-unconfirmed' : 'unavailable'
    }
  }

  return {
    startAssessment: (args) => perform('start-assessment', args),
    refuseRequest: (args) => perform('refuse', args)
  }
}
