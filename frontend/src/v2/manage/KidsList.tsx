import { useToday } from '@/v2/hooks/useToday'
import { Chip } from '@/v2/parent/Chip'
import { Icon } from '@/v2/parent/Icon'
import { ProgressRing } from '@/v2/parent/ProgressRing'
import type { Kid, TodayKid } from '@/v2/types'
import { initial, nameOf } from './choreMeta'

interface Props {
  kids: Kid[]
  selected?: string
  onSelect: (id: number | 'new') => void
}

/** Kid cards (letter avatar, balance line, today's progress ring, status chip) and the dashed "Add a kid" card. */
export function KidsList({ kids, selected, onSelect }: Props) {
  const today = new Map<number, TodayKid>((useToday().data?.kids ?? []).map((t) => [t.id, t]))
  return (
    <div className="pk-items">
      {kids.map((k) => {
        const t = today.get(k.id)
        const bits = [t?.progress ? `Level ${t.progress.level}` : '', t?.points !== undefined ? `${t.points} pts` : k.username]
        return (
          <button key={k.id} type="button" className="pk-card" data-selected={selected === String(k.id)} onClick={() => onSelect(k.id)}>
            <span className="pk-av" data-size="lg" aria-hidden="true">
              {initial(nameOf(k))}
            </span>
            <span className="pk-card-t">
              <span className="kl-line">
                <b>{nameOf(k)}</b>
                {t && <ProgressRing done={t.done ?? 0} total={t.total ?? 0} />}
              </span>
              <small>{bits.filter(Boolean).join(' · ')}</small>
            </span>
            {t?.online_all ? (
              <Chip tone="acc" icon="cloud_done">
                Online
              </Chip>
            ) : t && !t.devices?.length ? (
              <Chip tone="grey" icon="devices_off">
                No devices
              </Chip>
            ) : !k.has_pin ? (
              <Chip tone="lav" icon="lock_open">
                No PIN
              </Chip>
            ) : (
              <Chip tone="grey" icon="cloud_off">
                Offline
              </Chip>
            )}
          </button>
        )
      })}
      <button type="button" className="pk-card pk-new" data-selected={selected === 'new'} onClick={() => onSelect('new')}>
        <Icon name="add" size={18} />
        Add a kid
      </button>
    </div>
  )
}
