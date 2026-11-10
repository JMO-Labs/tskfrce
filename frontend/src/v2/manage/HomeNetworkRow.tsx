import { Icon } from '@/v2/parent/Icon'
import { Chip } from '@/v2/parent/Chip'
import { FocusArea, SummaryRow } from '@/v2/parent/SummaryRow'
import { LoadFail } from '@/v2/parent/states'
import { useFocusParam } from '@/v2/parent/useFocusParam'
import { useBlocker } from '@/v2/hooks/useDevices'
import { useFamily, usePatchFamily } from '@/v2/hooks/useFamily'
import { useSaveQueue } from '@/v2/hooks/useSaveQueue'
import { Info, Setr, Sw } from './FamilyRows'
import { ago } from './settingsMeta'

/** Family-wide network settings as one calm row at the top of the Devices list (opens in place). */
export function HomeNetworkRow() {
  const focus = useFocusParam('net', { group: ['open'], valid: (id) => id === 'net' })
  const famQ = useFamily()
  const fam = famQ.data
  const box = useBlocker().data
  const patch = usePatchFamily()
  const queue = useSaveQueue()
  if (!fam) {
    // same row, quiet while loading; if it cannot load, say so and offer a retry (never an empty gap)
    return (
      <div className="fam-rows"><FocusArea focus={focus} label="Home network" grouped>
        <SummaryRow id="net" icon={<Icon name="wifi" size={18} />} title="Home network" summary={famQ.isError ? "Couldn't load" : ''} loading={famQ.isPending} focus={focus}>
          {famQ.isError && <LoadFail error={famQ.error} onRetry={() => void famQ.refetch()} />}
        </SummaryRow>
      </FocusArea></div>
    )
  }
  const blocked = fam.new_devices_blocked
  const line = `${blocked ? 'New devices blocked' : 'New devices allowed'}${box ? ` · Box ${box.online ? 'healthy' : 'offline'}` : ''}`
  return (
    <div className="fam-rows"><FocusArea focus={focus} label="Home network" grouped>
      <SummaryRow id="net" icon={<Icon name="wifi" size={18} />} title="Home network" summary="" line2={focus.isOpen('net') ? undefined : line} focus={focus}>
        <div className="ch-setl">
          <Setr label="Block new devices until I assign them" info={<Info label="About blocking new devices">New phones and laptops stay paused until you give them an owner.</Info>}>
            <Sw label="Block new devices" checked={blocked} onChange={(v) => void queue(() => patch.mutateAsync({ new_devices_blocked: v }))} />
          </Setr>
          {box && (
            <Setr label="Home box">
              <Chip tone={box.online ? 'acc' : 'amb'} icon={box.online ? 'check_circle' : 'router'}>
                {box.online ? `Healthy${process.env.NEXT_PUBLIC_APP_VERSION ? ` · v${process.env.NEXT_PUBLIC_APP_VERSION}` : ''}` : `Offline · ${box.last_seen ? `last seen ${ago(box.last_seen)}` : 'never seen'}`}
              </Chip>
            </Setr>
          )}
        </div>
      </SummaryRow>
    </FocusArea></div>
  )
}
