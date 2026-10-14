import { registerModuleDetailTemplates } from '../core/templates.js'

export const addOverseasSiteModule = {
  type: {
    id: 'add-overseas-site',
    displayName: 'Add ORS',
    templateVersion: 'v1',
    initialState: 'submitted',
    states: [
      { id: 'submitted', displayName: 'Submitted' },
      { id: 'assessment-in-progress', displayName: 'Assessment in progress' },
      { id: 'approved', displayName: 'Granted', isTerminal: true },
      { id: 'rejected', displayName: 'Refused', isTerminal: true },
      { id: 'withdrawn', displayName: 'Withdrawn', isTerminal: true }
    ],
    transitions: [
      {
        actionId: 'start-assessment',
        displayName: 'Start assessment',
        fromStateId: 'submitted',
        toStateId: 'assessment-in-progress',
        callerInvocable: false
      },
      {
        actionId: 'approve',
        displayName: 'Approve',
        fromStateId: 'assessment-in-progress',
        toStateId: 'approved',
        callerInvocable: false
      },
      {
        actionId: 'reject',
        displayName: 'Refuse',
        fromStateId: 'assessment-in-progress',
        toStateId: 'rejected',
        callerInvocable: false
      },
      {
        actionId: 'withdraw',
        displayName: 'Withdraw',
        fromStateId: 'submitted',
        toStateId: 'withdrawn',
        callerInvocable: false
      }
    ]
  },
  async register() {
    registerModuleDetailTemplates('add-overseas-site', {
      v1: 'add-overseas-site/detail-v1'
    })
  }
}
