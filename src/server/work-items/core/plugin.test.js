import { describe, test, expect, beforeEach, vi } from 'vitest'
import hapi from '@hapi/hapi'

import { workItemsPlugin } from './plugin.js'
import {
  clearWorkItemRegistry,
  getWorkItemType,
  getWorkItemTypes
} from './registry.js'

const buildModule = (id, registerSpy = vi.fn()) => ({
  type: {
    id,
    displayName: id,
    initialState: { id: 'submitted', displayName: 'Submitted' },
    states: [{ id: 'submitted', displayName: 'Submitted' }],
    getTasksForState: () => []
  },
  register: registerSpy
})

const newServer = () => hapi.server()

describe('workItemsPlugin', () => {
  beforeEach(() => clearWorkItemRegistry())

  test('registers each module type and invokes its register callback with the server', async () => {
    const server = newServer()
    const registerA = vi.fn(async () => {})
    const registerB = vi.fn(async () => {})
    const modules = [buildModule('alpha', registerA), buildModule('beta', registerB)]

    await server.register(workItemsPlugin(modules))

    expect(getWorkItemTypes().map((t) => t.id)).toEqual(['alpha', 'beta'])
    expect(registerA).toHaveBeenCalledTimes(1)
    expect(registerB).toHaveBeenCalledTimes(1)
    // The argument passed should expose Hapi's `route` API.
    expect(typeof registerA.mock.calls[0][0].route).toBe('function')
  })

  test('routes mounted by a module are reachable on the server', async () => {
    const server = newServer()
    const module = buildModule('greeter', async (registeredServer) => {
      registeredServer.route({
        method: 'GET',
        path: '/work-items/greeter/hello',
        handler: () => 'world'
      })
    })

    await server.register(workItemsPlugin([module]))

    const response = await server.inject({
      method: 'GET',
      url: '/work-items/greeter/hello'
    })

    expect(response.statusCode).toBe(200)
    expect(response.result).toBe('world')
    expect(getWorkItemType('greeter')).toBe(module.type)
  })

  test('clears registry on each registration so repeated boots do not duplicate types', async () => {
    const moduleA = buildModule('alpha')
    const moduleB = buildModule('beta')

    await newServer().register(workItemsPlugin([moduleA]))
    expect(getWorkItemTypes().map((t) => t.id)).toEqual(['alpha'])

    await newServer().register(workItemsPlugin([moduleB]))
    expect(getWorkItemTypes().map((t) => t.id)).toEqual(['beta'])
  })

  test('throws when a module is invalid', async () => {
    const server = newServer()
    await expect(
      server.register(workItemsPlugin([{ register: async () => {} }]))
    ).rejects.toThrow(/non-empty string id/)
  })

  test('throws on a duplicate type id across modules', async () => {
    const server = newServer()
    await expect(
      server.register(
        workItemsPlugin([buildModule('alpha'), buildModule('alpha')])
      )
    ).rejects.toThrow(/already registered/)
  })
})
