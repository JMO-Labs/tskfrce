import { useState } from 'react'
import { useMediaQuery } from '@mantine/hooks'
import { Menu } from '@mantine/core'
import { useRouter } from 'next/router'
import { viewAs } from '@/v2/kid/viewAs'
import Link from 'next/link'
import { useDevices } from '@/v2/hooks/useDevices'
import { useLibrary } from '@/v2/hooks/useChores'
import { useToday } from '@/v2/hooks/useToday'
import { useKidPoints } from '@/v2/hooks/useKids'
import { Chip } from '@/v2/parent/Chip'
import { HeaderChips } from '@/v2/parent/HeaderChips'
import { Icon } from '@/v2/parent/Icon'
import { useChoreTypes } from '@/v2/hooks/useChoreTypes'
import { threadGlyph } from '@/v2/today/choreIcon'
import type { Kid } from '@/v2/types'
import { AGE_LABEL } from './ageGroups'
import { HappyHourButton } from '@/v2/today/HappyHourButton'
import { KidCelebrations } from './KidCelebrations'
import { KidEditor } from './KidEditor'
import { KidPhonesPanel } from './KidPhonesPanel'
import { dayTime } from './SelfApprovedList'
import { TrustSection } from './TrustSection'
import { PointsForm } from './PointsForm'
import { initial, nameOf, schedules } from './choreMeta'
import { DEVICE_TYPE_ICON, getDeviceType } from './deviceMeta'

type Mode = 'bonus' | 'deduct' | 'edit'

interface Props {
  kid: Kid
  /** Open the editor with the PIN field focused (deep link from the PIN nudge). */
  focusPin?: boolean
  onDeleted: () => void
}

/** Kid header and actions, with Bonus / Deduct / Edit opening below; chores and devices from existing data. */
export function KidDetail({ kid, focusPin, onDeleted }: Props) {
  const { asPath } = useRouter()
  const [mode, setMode] = useState<Mode | null>(focusPin ? 'edit' : null)
  const t = useToday().data?.kids.find((k) => k.id === kid.id)
  const chores = (useLibrary().data ?? []).filter((c) => c.assignments.some((a) => a.active && a.kid_ids.includes(kid.id)))
  const types = useChoreTypes().data
  const glyphs = new Map((Array.isArray(types) ? types : []).map((ty) => [ty.id, ty.glyph]))
  const devices = (useDevices().data ?? []).filter((d) => d.owner_ids.includes(kid.id))
  // closing an inline form hands focus back to the button that opened it
  const closeForm = (m: Mode) => {
    setMode(null)
    requestAnimationFrame(() => document.getElementById(m === 'edit' ? 'kid-act-edit' : 'kid-act-more')?.focus())
  }
  const toggle = (m: Mode) => setMode(mode === m ? null : m)
  const name = nameOf(kid)
  const phone = !!useMediaQuery('(max-width: 767px)')
  const view = (
    <Link className="p-btn" href={viewAs(kid.id, asPath)}>
      <Icon name="visibility" />
      View as kid
    </Link>
  )

  return (
    <div className="pk-detail">
      <header className="pk-head">
        <span className="pk-av" data-size="xl" aria-hidden="true">
          {initial(name)}
        </span>
        <div className="pk-head-t">
          <h2>{name}</h2>
          <HeaderChips
            items={[
              t?.points !== undefined && { icon: 'stars', text: `${t.points} pts`, tone: 'acc' as const },
              t?.progress && { icon: 'trending_up', text: `Level ${t.progress.level}` },
            ].filter((c) => !!c)}
          />
        </div>
        <div className="pk-actions">
          {!phone && view}
          <HappyHourButton kidId={kid.id} />
          <button type="button" id="kid-act-edit" className="p-btn" data-variant="accent" aria-pressed={mode === 'edit'} onClick={() => toggle('edit')}>
            <Icon name="edit" />
            Edit
          </button>
          <Menu position="bottom-end" withinPortal returnFocus={false}>
            <Menu.Target>
              <button type="button" id="kid-act-more" className="p-btn" aria-label="More">
                <Icon name="more_horiz" />
              </button>
            </Menu.Target>
            <Menu.Dropdown>
              {phone && (
                <Menu.Item component={Link} href={viewAs(kid.id, asPath)} leftSection={<Icon name="visibility" size={17} />}>
                  View as kid
                </Menu.Item>
              )}
              <Menu.Item leftSection={<Icon name="add_circle" size={17} />} onClick={() => setMode('bonus')}>
                Bonus
              </Menu.Item>
              <Menu.Item color="red" leftSection={<Icon name="remove_circle" size={17} />} onClick={() => setMode('deduct')}>
                Deduct
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </div>
      </header>

      <div className="pk-grid">
        {(mode === 'bonus' || mode === 'deduct') && <PointsForm key={mode} kid={kid} kind={mode} onClose={() => closeForm(mode)} />}
        {mode === 'edit' && <KidEditor kid={kid} focusPin={focusPin} onDone={onDeleted} />}

        <TrustSection kid={kid} />

        <section className="pk-panel" aria-label="Profile">
          <h3>
            <Icon name="badge" size={18} />
            Profile
          </h3>
          <div className="pk-kv"><span>Name</span><b>{name}</b></div>
          <div className="pk-kv"><span>Age group</span><b>{AGE_LABEL[kid.age_group]}</b></div>
          <div className="pk-kv"><span>PIN</span><b>{kid.has_pin ? '•••• set' : 'Not set'}</b></div>
          {t?.points !== undefined && <div className="pk-kv"><span>Points</span><b>{t.points}</b></div>}
          {t?.next_reward != null && <div className="pk-kv"><span>Next reward</span><b>{t.next_reward} pts away</b></div>}
        </section>

        <section className="pk-panel" aria-label="Devices">
          <h3>
            <Icon name="devices" size={18} />
            Devices
          </h3>
          {devices.length === 0 && <p className="pk-hint">No devices assigned yet.</p>}
          {devices.map((d) => (
            <div key={d.id} className="pk-line">
              <span className="pk-card-t pk-dev">
                <Icon name={DEVICE_TYPE_ICON[getDeviceType(d.name, d.vendor)]} size={16} />
                <b>{d.name}</b>
              </span>
              {d.exempt ? (
                <Chip tone="lav" icon="verified_user">Exempt</Chip>
              ) : d.online ? (
                <Chip tone="acc" icon="lock_open">Open</Chip>
              ) : (
                <Chip tone="grey" icon="lock">Locked</Chip>
              )}
            </div>
          ))}
        </section>

        <KidPhonesPanel kid={kid} />

        <KidCelebrations kid={kid} />

        <section className="pk-panel pk-span" aria-label="Chores assigned">
          <h3>
            <Icon name="task_alt" size={18} />
            Chores assigned
          </h3>
          {chores.length === 0 && <p className="pk-hint">No chores assigned yet.</p>}
          <div className="pk-tags">
            {chores.map((c) => (
              <span key={c.id} className="pk-tag">
                <Icon name={threadGlyph(glyphs.get(c.type_id), c.title)} size={16} />
                {[c.title, ...schedules(c, kid.id)].join(' · ')}
              </span>
            ))}
          </div>
        </section>

        <PointsHistory kidId={kid.id} />
      </div>
    </div>
  )
}

function PointsHistory({ kidId }: { kidId: number }) {
  const { data } = useKidPoints(kidId)
  const rows = Array.isArray(data) ? data : []
  return (
    <section className="pk-panel pk-span" aria-label="Points history">
      <h3>
        <Icon name="history" size={18} />
        Points history
      </h3>
      {data && rows.length === 0 && <p className="pk-hint">No points yet.</p>}
      {rows.map((p) => (
        <div key={p.id} className="pk-kv">
          <span className="pk-ph-l">{`${dayTime(p.at)} · ${p.label}`}</span>
          <b data-neg={p.amount < 0 || undefined} className="pk-ph-n">
            {p.amount < 0 ? `−${-p.amount}` : `+${p.amount}`}
          </b>
        </div>
      ))}
    </section>
  )
}
