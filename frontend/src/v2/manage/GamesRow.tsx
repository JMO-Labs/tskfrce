import { SegmentedControl } from '@mantine/core'
import { useKids, usePatchKid } from '@/v2/hooks/useKids'
import type { Family } from '@/v2/types'
import { toastFail } from '../notify'
import { Info, Setr, Sw, type SaveFamily } from './FamilyRows'

type Earn = NonNullable<Family['games_earn']>
const EARN_LABEL: Record<Earn, string> = { every: 'Every chore', daily: 'Once a day', random: 'Random', custom: 'Custom' }
const CAPS = Array.from({ length: 11 }, (_, i) => i * 5)

export const gamesLine = (f: Family) =>
  f.games_on ? `${EARN_LABEL[f.games_earn ?? 'every']} · Cap ${f.games_cap_pct ?? 10}% · Board ${f.games_board ? 'on' : 'off'}` : 'Off'

/** Body of the Minigames row: on/off, how games are earned, points cap, leaderboard, per-kid switches. */
export function GamesBody({ fam, save }: { fam: Family; save: SaveFamily }) {
  const kids = useKids().data ?? []
  const patchKid = usePatchKid()
  return (
    <div className="ch-setl">
      <Setr label="Minigames" info={<Info label="About minigames">Kids earn a quick game for doing chores.</Info>}>
        <Sw label="Minigames" checked={!!fam.games_on} onChange={(v) => void save({ games_on: v })} />
      </Setr>
      {fam.games_on && (
        <>
          <Setr label="Earn a game">
            <SegmentedControl
              className="gm-seg"
              size="xs"
              aria-label="Earn a game"
              data={(Object.keys(EARN_LABEL) as Earn[]).map((v) => ({ label: EARN_LABEL[v], value: v }))}
              value={fam.games_earn ?? 'every'}
              onChange={(v) => void save({ games_earn: v as Earn })}
            />
          </Setr>
          {fam.games_earn === 'custom' && <span className="pk-hint ch-hint">Pick chores in the chore editor: Earns a game.</span>}
          <Setr label="Game points cap" info={<Info label="About the points cap">Most points games can add, as a share of a kid&apos;s chore points.</Info>}>
            <select className="pk-input gm-cap" aria-label="Game points cap" value={fam.games_cap_pct ?? 10} onChange={(e) => void save({ games_cap_pct: Number(e.currentTarget.value) })}>
              {CAPS.map((c) => <option key={c} value={c}>{c}% of chore points</option>)}
            </select>
          </Setr>
          <Setr label="Family leaderboard">
            <Sw label="Family leaderboard" checked={!!fam.games_board} onChange={(v) => void save({ games_board: v })} />
          </Setr>
          {kids.length > 0 && (
            <>
              <span className="ch-lb">Per kid</span>
              {kids.map((k) => {
                const name = k.full_name || k.username
                return (
                  <Setr key={k.id} label={name}>
                    <Sw label={`${name} plays games`} checked={k.games_on !== false} onChange={(v) => patchKid.mutate({ id: k.id, body: { games_on: v } }, { onError: toastFail })} />
                  </Setr>
                )
              })}
            </>
          )}
        </>
      )}
    </div>
  )
}
