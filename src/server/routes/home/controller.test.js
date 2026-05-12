import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { config } from '#/config/config.js'

describe('#homeController', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  test('Should provide expected response', async () => {
    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/'
    })

    expect(result).toEqual(expect.stringContaining('Home |'))
    expect(statusCode).toBe(statusCodes.ok)
  })

  describe('RA-127 create-work-item entry link', () => {
    const flagKey = 'featureFlags.workItemCreationEnabled'
    let originalFlag

    beforeEach(() => {
      originalFlag = config.get(flagKey)
    })

    afterEach(() => {
      config.set(flagKey, originalFlag)
    })

    test('renders the link when the flag is on', async () => {
      config.set(flagKey, true)
      const { result } = await server.inject({ method: 'GET', url: '/' })
      expect(result).toEqual(
        expect.stringContaining('data-testid="home-create-work-item-link"')
      )
    })

    test('hides the link when the flag is off', async () => {
      config.set(flagKey, false)
      const { result } = await server.inject({ method: 'GET', url: '/' })
      expect(result).not.toEqual(
        expect.stringContaining('data-testid="home-create-work-item-link"')
      )
    })
  })
})
