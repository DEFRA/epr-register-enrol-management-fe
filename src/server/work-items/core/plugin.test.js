import { describe, test, expect, beforeEach, vi } from 'vitest'
import hapi from '@hapi/hapi'

import { workItemsPlugin } from './plugin.js'
import {
  clearWorkItemRegistry,
  getWorkItemType,
  getWorkItemTypes
} from './registry.js'
import {
  clearDetailTemplateRegistry,
  registerModuleDetailTemplates
} from './templates.js'

const buildModule = (id, registerSpy = vi.fn()) => ({
  type: {
    id,
    displayName: id,
    templateVersion: 'v1',
    initialState: { id: 'submitted', displayName: 'Submitted' },
    states: [{ id: 'submitted', displayName: 'Submitted' }],
    transitions: [],
    getTasksForState: () => []
  },
  register: registerSpy
})

const newServer = () => hapi.server()

describe('workItemsPlugin', () => {
  beforeEach(() => {
    clearWorkItemRegistry()
    clearDetailTemplateRegistry()
  })

  test('registers each module type and invokes its register callback with the server', async () => {
    const server = newServer()
    const registerA = vi.fn(async () => {})
    const registerB = vi.fn(async () => {})
    const modules = [
      buildModule('alpha', registerA),
      buildModule('beta', registerB)
    ]

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

  test('throws when a module registers detail templates but not for its own declared templateVersion', async () => {
    const server = newServer()
    const module = {
      type: { ...buildModule('drifted').type, templateVersion: 'v2' },
      register: async () => {
        registerModuleDetailTemplates('drifted', { v1: 'drifted/detail-v1' })
      }
    }

    await expect(server.register(workItemsPlugin([module]))).rejects.toThrow(
      /declares templateVersion "v2"/
    )
  })

  test('does not throw when a module never registers a bespoke detail template', async () => {
    const server = newServer()
    await server.register(workItemsPlugin([buildModule('generic-only')]))
    expect(getWorkItemTypes().map((t) => t.id)).toEqual(['generic-only'])
  })
})
