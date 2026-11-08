import { describe, expect, test } from '@jest/globals'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { InboxRow } from '@/v2/components/InboxRow'
import type { InboxItem } from '@/v2/hooks/useInbox'

const n: InboxItem = {
  id: 1, kind: 'integration_done', title: 'Dishes', body: null, created_at: new Date().toISOString(), read: false,
  run_id: 7, redemption_id: null, device_id: null, thread_id: null, points: 5, kid_id: 3, kid_name: 'Sam', glyph: null, pending: true,
}

describe('InboxRow', () => {
  test('integration_done: Approve is the one main button, Send back is in the menu', async () => {
    const f = () => {}
    render(<MantineProvider env="test"><InboxRow n={n} live busy={false} sending={false} note="" onNote={f} onApprove={f} onSendBack={f} onDecide={f} onDismiss={f} onOpen={f} go={async () => {}} /></MantineProvider>)
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Send back' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'More for Dishes' }))
    expect(await screen.findByRole('menuitem', { name: 'Send back' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Dismiss' })).toBeInTheDocument()
  })
})
