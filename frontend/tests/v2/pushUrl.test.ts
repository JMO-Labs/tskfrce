import { describe, expect, test } from '@jest/globals'
import { isLocalHost, pushUrlFor } from '@/v2/integrations/pushUrl'

describe('pushUrlFor', () => {
  test.each(['192.168.1.20', '10.0.0.5', '172.16.4.2', 'localhost', 'box.local', 'homebox'])('fills in %s', (h) => {
    expect(pushUrlFor(h)).toBe(`http://${h}:3000/api/proxy/integration-local/push`)
  })
  test.each(['tasks.example.com', '8.8.8.8', '172.32.0.1', '100.64.1.1', '', undefined])('keeps the placeholder for %s', (h) => {
    expect(pushUrlFor(h)).toBe('http://<box>:3000/api/proxy/integration-local/push')
  })
  test('rejects a number-only name', () => expect(isLocalHost('12345')).toBe(false))
})
