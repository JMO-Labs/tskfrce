import { Chip } from '@/v2/parent/Chip'
import { LoadFail, Skeleton } from '@/v2/parent/states'
import { useBlocker } from '@/v2/hooks/useDevices'
import { useFamily, usePatchFamily } from '@/v2/hooks/useFamily'
import { useSaveQueue } from '@/v2/hooks/useSaveQueue'
import { Info, Setr, Sw } from './FamilyRows'
import { NetworksCard } from './NetworksCard'
import { PaneCard, PaneHead } from './PaneParts'
import { ago } from './settingsMeta'

/** Settings → Home network: what new devices may do, and how the home box is doing. */
export function HomeNetworkPane() {
  const famQ = useFamily()
  const fam = famQ.data
  const box = useBlocker().data
  const patch = usePatchFamily()
  const queue = useSaveQueue()
  return (
    <>
      <PaneHead title="Home network" sub="New-device policy and the home box" />
      {famQ.isError && <LoadFail error={famQ.error} onRetry={() => void famQ.refetch()} />}
      {famQ.isPending && <Skeleton />}
      {fam && (
        <PaneCard icon="wifi" title="Home network">
          <div className="ch-setl">
            <Setr label="Block new devices until I assign them" info={<Info label="About blocking new devices">New phones and laptops stay paused until you give them an owner.</Info>}>
              <Sw label="Block new devices" checked={fam.new_devices_blocked} onChange={(v) => void queue(() => patch.mutateAsync({ new_devices_blocked: v }))} />
            </Setr>
            {box && (
              <Setr label="Home box">
                <Chip tone={box.online ? 'acc' : 'amb'} icon={box.online ? 'check_circle' : 'router'}>
                  {box.online ? `Healthy${process.env.NEXT_PUBLIC_APP_VERSION ? ` · v${process.env.NEXT_PUBLIC_APP_VERSION}` : ''}` : `Offline · ${box.last_seen ? `last seen ${ago(box.last_seen)}` : 'never seen'}`}
                </Chip>
              </Setr>
            )}
          </div>
        </PaneCard>
      )}
      <NetworksCard />
    </>
  )
}
