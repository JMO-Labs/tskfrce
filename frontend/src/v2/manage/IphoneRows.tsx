import { useDisclosure } from '@mantine/hooks'
import { Modal, Switch } from '@mantine/core'
import { useFamily, usePatchFamily } from '@/v2/hooks/useFamily'
import { useKidPush, useResetKidPush } from '@/v2/hooks/useKidPush'
import { useKids } from '@/v2/hooks/useKids'
import { Icon } from '@/v2/parent/Icon'
import type { Kid } from '@/v2/types'
import { toasted, toastOk } from '@/v2/notify'
import { ConfirmDelete } from './ConfirmDelete'
import { initial, nameOf } from './choreMeta'

const GUIDE_DOC = 'https://github.com/JMO-Labs/tskfrce/blob/main/docs/guide/04-everyday-use.md#alerts-on-a-kids-phone'

function KidPhone({ kid }: { kid: Kid }) {
  const push = useKidPush(kid.id)
  const reset = useResetKidPush()
  const [confirm, { open, close }] = useDisclosure(false)
  const name = nameOf(kid)
  const d = push.data
  if (!d?.enabled) return null
  return (
    <section className="pk-panel" aria-label={`${name} phone`}>
      <h3>
        <span className="pk-av" aria-hidden="true">{kid.avatar || initial(name)}</span>
        {name}
      </h3>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img alt={`Kid phone code for ${name}`} className="pk-qr" width={168} height={168} src={`data:image/svg+xml;utf8,${encodeURIComponent(d.qr_svg)}`} />
      <p className="pk-hint">1. Install the ntfy app on {name}&apos;s phone. 2. Scan this code with the phone camera.</p>
      <p className="pk-hint">
        Or add it by hand: server <span className="pk-mono">{d.server}</span>, topic <span className="pk-mono">{d.topic}</span>
      </p>
      <div className="pk-actions">
        <button type="button" className="p-btn" onClick={open} disabled={reset.isPending}>
          <Icon name="qr_code_2" />
          New code
        </button>
      </div>
      <ConfirmDelete
        opened={confirm}
        title="Make a new code?"
        body={`${name}'s phone stops getting alerts until you scan the new code.`}
        confirmLabel="New code"
        onConfirm={() => reset.mutate(kid.id, { onSuccess: () => toastOk('New code ready') })}
        onClose={close}
      />
    </section>
  )
}

/** What the iPhones row says on its closed line. `enabled` is whether the box can send phone alerts at all (undefined while loading). */
export const iphoneSummary = (relay: boolean | undefined, enabled?: boolean): string =>
  enabled === false ? 'Not set up' : relay ? 'Instant (relay)' : 'Late (no relay)'

// the ntfy service and the relay are box-wide, so the first kid's answer tells us
export const useBoxPush = () => {
  const first = useKids().data?.[0]
  return useKidPush(first?.id ?? 0, !!first).data
}

/** The one (i) for the iPhones row: how alerts reach iPhones, what leaves the home, and what to do when it is not set up. */
export function IphoneHelp() {
  const d = useBoxPush()
  return (
    <>
      <p className="ch-pop-p">The box asks ntfy.sh to wake iPhones with a content-free poll request; the alert text stays in your home. Without it, iPhones get alerts late.</p>
      {d?.upstream ? (
        <p className="ch-pop-p">Kid phones signed in with a code get a short generic line, like &apos;You have a new chore&apos;, through a public relay (ntfy.sh by default). Names, chores and messages stay in your home.</p>
      ) : d?.enabled ? (
        <p className="ch-pop-p">Alert text stays in your home.</p>
      ) : d ? (
        <p className="ch-pop-p">
          Phone alerts aren&apos;t set up on this box. See the guide: <a href={GUIDE_DOC} target="_blank" rel="noreferrer">Alerts on a kid&apos;s phone</a>
        </p>
      ) : null}
    </>
  )
}

/** iPhones row body: the family-wide relay switch, then a QR button that shows each kid's ntfy code. */
export function IphoneBody() {
  const kids = useKids().data ?? []
  const fam = useFamily().data
  const patch = usePatchFamily()
  const d = useBoxPush()
  const [qr, { open, close }] = useDisclosure(false)
  if (d && !d.enabled) return <p className="pk-hint">Not set up on this box. Tap the (i) for the setup guide.</p>
  return (
    <>
      {d?.enabled && fam && (
        <Switch
          className="pn-sw pn-line"
          label="Instant alerts (relay through ntfy.sh)"
          labelPosition="left"
          checked={fam.ntfy_upstream_relay}
          disabled={patch.isPending}
          onChange={(e) => void toasted(patch.mutateAsync({ ntfy_upstream_relay: e.currentTarget.checked }), 'Saved')}
        />
      )}
      {d?.enabled && kids.length > 0 && (
        <div className="pn-line">
          <span>Use the ntfy app instead</span>
          <button type="button" className="p-btn" onClick={open}>
            <Icon name="qr_code_2" size={16} />
            QR
          </button>
          <Modal opened={qr} onClose={close} title="Use the ntfy app instead" centered zIndex={300} classNames={{ body: 'ip-body' }}>
            {kids.map((k) => <KidPhone key={k.id} kid={k} />)}
          </Modal>
        </div>
      )}
    </>
  )
}
