import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { useSaveQueue } from '../hooks/useSaveQueue'
import { Icon } from '../parent/Icon'
import { InfoPop } from '../parent/InfoPop'
import { KidPicker, type PickerExtra } from '../parent/KidPicker'
import { FocusArea, SummaryRow } from '../parent/SummaryRow'
import { LoadFail, RowsSkeleton } from '../parent/states'
import { useFocusParam } from '../parent/useFocusParam'
import { DEVICE_TYPE_ICON, getDeviceType } from '../manage/deviceMeta'
import { isPrivateMac } from '../manage/privateMac'
import type { Device, Kid } from '../types'
import styles from './devices.module.css'

const GUEST = 'guest'
const UNSURE = 'unsure'
const EXTRAS: PickerExtra[] = [
  { value: GUEST, label: 'Guest (never blocked)', short: 'Guest', icon: 'shield' },
  { value: UNSURE, label: 'Not sure yet', icon: 'close' },
]
const validRow = (id: string) => id === 'need' || id === 'done'

/** Step 6: devices split into "Need an owner" and "Done"; each device has one owner pop-over. */
export function StepDevices({ kids }: { kids: Kid[] }) {
  const qc = useQueryClient()
  const run = useSaveQueue()
  const focus = useFocusParam('open', { valid: validRow, replace: true }) // the wizard step is not in the URL: no history entry for a row
  const list = useQuery({ queryKey: ['setup-devices'], queryFn: () => api<Device[]>('/devices'), refetchInterval: 5000, refetchIntervalInBackground: false })

  // The owner shown is always the server's; a failed save toasts and the next refetch shows the old owner again.
  const save = (d: Device, status: Device['status'], owner_ids: number[]) =>
    void run(() => api<Device>(`/devices/${d.id}`, { method: 'PATCH', body: { status, owner_ids } })).then(() => qc.invalidateQueries({ queryKey: ['setup-devices'] }))

  const change = (d: Device, vals: string[]) => {
    const v = vals[0]
    if (v === GUEST) return save(d, 'guest', [])
    if (v === undefined || v === UNSURE) return save(d, 'unassigned', [])
    save(d, 'assigned', [Number(v)])
  }

  const devices = list.data ?? []
  const need = devices.filter((d) => d.status === 'unassigned')
  const done = devices.filter((d) => d.status !== 'unassigned')
  const privateMacs = devices.filter((d) => isPrivateMac(d.mac)).length

  const deviceRow = (d: Device) => {
    const value = d.status === 'guest' ? [GUEST] : d.owner_ids.map(String)
    return (
      <div key={d.id} className={styles.dv} data-owned={value.length ? '' : undefined}>
        <div className={styles.ic}>
          <Icon name={DEVICE_TYPE_ICON[getDeviceType(d.name, d.vendor)]} size={20} />
        </div>
        <div className={styles.t2}>
          <b className="p-kn" title={d.name}>{d.name}</b>
          <small>{[d.vendor || 'Unknown maker', d.ip].filter(Boolean).join(' · ')}</small>
        </div>
        <KidPicker variant="pop" single kids={kids} extras={EXTRAS} value={value} label={`Owner for ${d.name}`} onChange={(v) => change(d, v)} />
      </div>
    )
  }

  const names = need.slice(0, 2).map((d) => d.name).join(', ')
  return (
    <>
      {list.isError && !list.data && <LoadFail error={list.error} onRetry={() => void list.refetch()} />}
      <div className={styles.head}>
        <span className={styles.pulse} aria-hidden="true" />
        <b>Looking for devices…{list.data ? ` ${list.data.length} found` : ''}</b>
      </div>
      {list.isPending && <RowsSkeleton rows={2} />}
      {devices.length > 0 && (
        <FocusArea focus={focus} grouped>
          <SummaryRow
            id="need"
            icon={<Icon name="warning" size={18} />}
            title="Need an owner"
            summary={`${need.length} left`}
            line2={<span className={styles.l2}>{need.length ? `${names}${need.length > 2 ? ` +${need.length - 2} more` : ''}` : 'All devices have an owner'}</span>}
            focus={focus}
          >
            {need.length ? need.map(deviceRow) : <p className={styles.none}>All set. Nice.</p>}
          </SummaryRow>
          <SummaryRow id="done" icon={<Icon name="check" size={18} />} title="Done" summary={String(done.length)} focus={focus}>
            {done.length ? done.map(deviceRow) : <p className={styles.none}>No device has an owner yet.</p>}
          </SummaryRow>
        </FocusArea>
      )}
      {list.data && devices.length === 0 && <p className={styles.none}>No devices yet. Unlock a device and open a web page, or skip and add them later.</p>}
      <div className={styles.tip}>
        <Icon name="info" size={20} />
        <span className={styles.grow}>Not seeing a device, or one keeps changing?</span>
        <InfoPop label="More about missing or changing devices" width={320} target={<button type="button" className={styles.more}>More</button>}>
          <p className={styles.pp}><b>Not seeing a device?</b> Unlock it and open a web page so it talks to the network.</p>
          <p className={styles.pp}>
            <b>Keeps changing?</b> {privateMacs > 0 && `${privateMacs} of these use a private Wi-Fi address. `}On iPhones and iPads, turn off “Private Wi-Fi Address” for your home Wi-Fi.
          </p>
        </InfoPop>
      </div>
    </>
  )
}
