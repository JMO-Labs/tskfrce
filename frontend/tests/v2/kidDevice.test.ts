import { beforeEach, describe, expect, test } from '@jest/globals'
import { KID_TOKEN_KEY } from '@/v2/api'
import { alertLink, clearDevice, deviceKid, deviceToken, refreshKid, removedMsg, saveAlert, saveDevice, takeEnrollToken } from '@/v2/kid/kidDevice'

const fetchMock = jest.fn()
const reply = (status: number, body: unknown) => ({ status, ok: status < 400, json: async () => body, text: async () => JSON.stringify(body) })
const ok = { access_token: 'acc', kid: { id: 3, full_name: 'Ana', avatar: '🦊' }, alert: { server: 'https://ntfy.sh', topic: 't1' } }

beforeEach(() => {
  localStorage.clear()
  fetchMock.mockReset()
  global.fetch = fetchMock as never
  clearDevice()
})

describe('kid device', () => {
  test('takeEnrollToken reads the hash and strips it', () => {
    window.history.replaceState(null, '', '/kid#enroll=abc')
    expect(takeEnrollToken()).toBe('abc')
    expect(window.location.pathname + window.location.hash).toBe('/kid')
    expect(takeEnrollToken()).toBeNull()
  })

  test('refresh 200 stores the session and the kid', async () => {
    saveDevice('dev')
    fetchMock.mockResolvedValue(reply(200, ok))
    expect(await refreshKid()).toBe(true)
    expect(localStorage.getItem(KID_TOKEN_KEY)).toBe('acc')
    expect(deviceKid()?.full_name).toBe('Ana')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ device_token: 'dev' })
  })

  test('refresh 401 clears the device and keeps the message', async () => {
    saveDevice('dev')
    fetchMock.mockResolvedValue(reply(401, { detail: 'This phone was removed. Ask a parent for a new code.' }))
    expect(await refreshKid()).toBe(false)
    expect(deviceToken()).toBeNull()
    expect(removedMsg()).toMatch(/phone was removed/)
  })

  test('concurrent refreshes share one request', async () => {
    saveDevice('dev')
    fetchMock.mockResolvedValue(reply(200, ok))
    expect(await Promise.all([refreshKid(), refreshKid()])).toEqual([true, true])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('no device token means no request', async () => {
    expect(await refreshKid()).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('saveAlert reports a changed topic', () => {
    expect(saveAlert({ server: 'https://ntfy.sh', topic: 'a' })).toBe(false)
    expect(saveAlert({ server: 'https://ntfy.sh', topic: 'a' })).toBe(false)
    expect(saveAlert({ server: 'https://ntfy.sh', topic: 'b' })).toBe(true)
  })

  test('alertLink', () => {
    expect(alertLink({ server: 'https://ntfy.sh', topic: 't' })).toBe('ntfy://ntfy.sh/t?display=t%40sk4ce')
    expect(alertLink({ server: 'http://box:2586', topic: 't' })).toBe('ntfy://box:2586/t?display=t%40sk4ce&secure=false')
  })
})

describe('alerts-moved flag', () => {
  test('survives a remount, clears on tap and on clearDevice', () => {
    const load = () => {
      let m!: typeof import('@/v2/kid/movedFlag')
      jest.isolateModules(() => { m = require('@/v2/kid/movedFlag') })
      return m
    }
    load().setAlertsMoved(true)
    expect(localStorage.getItem('task4ce-kid-alerts-moved')).toBe('1')
    const again = load() // fresh module = remount
    expect(again.alertsMoved()).toBe(true)
    again.setAlertsMoved(false) // tap
    expect(load().alertsMoved()).toBe(false)
    again.setAlertsMoved(true)
    clearDevice()
    expect(load().alertsMoved()).toBe(false)
  })
})
