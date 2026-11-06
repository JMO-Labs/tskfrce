import { describe, expect, test } from '@jest/globals'
import { render, screen } from '@testing-library/react'
import { BellActions } from '@/v2/components/BellActions'
import type { InboxItem } from '@/v2/hooks/useInbox'

const n: InboxItem = {
  id: 1, kind: 'integration_done', title: 'Dishes', body: null, created_at: new Date().toISOString(), read: false,
  run_id: 7, redemption_id: null, device_id: null, thread_id: null, points: 5, kid_id: 3, kid_name: 'Sam', glyph: null, pending: true,
}

describe('BellActions', () => {
  test('integration_done shows Approve and Send back', () => {
    const f = () => {}
    render(<BellActions n={n} busy={false} sending={false} note="" onNote={f} onApprove={f} onSendBack={f} onDecide={f} go={async () => {}} />)
    expect(screen.getByRole('button', { name: /Approve \+5/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send back' })).toBeInTheDocument()
  })
})
