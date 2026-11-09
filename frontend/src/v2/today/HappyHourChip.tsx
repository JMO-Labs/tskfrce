import { useHappyHours, useStopHappyHour } from '../hooks/useHappyHour'
import { useKids } from '../hooks/useKids'
import { Icon } from '../parent/Icon'
import { InfoPop } from '../parent/InfoPop'
import type { HappyHour } from '../types'
import { toastFail, toastOk } from '../notify'
import { hhWho, multText, useMinutesLeft } from './HappyHourButton'
import { useClock } from './useClock'

function Running({ h }: { h: HappyHour }) {
  const left = useMinutesLeft(h.ends_at)
  const kids = useKids().data ?? []
  const clock = useClock()
  const stop = useStopHappyHour()
  const onStop = () => stop.mutate(h.id, { onSuccess: () => toastOk('Happy hour stopped'), onError: toastFail })
  return (
    <InfoPop
      label="Happy hour"
      width={250}
      target={
        <button type="button" className="p-pill" data-tone="acc">
          <Icon name="bolt" size={14} />
          Happy hour {multText(h.mult_x10)} · {left} min
        </button>
      }
    >
      <div className="pt-hhpop">
        <span>For {hhWho(h, kids)} · ends {clock(h.ends_at)}</span>
        <button type="button" className="p-btn" data-variant="red" disabled={stop.isPending} onClick={onStop}>
          <Icon name="stop_circle" size={17} />
          Stop now
        </button>
      </div>
    </InfoPop>
  )
}

/** Shows while a happy hour runs; Stop lives in its pop-over. Starting one is in the Today header "…". */
export function HappyHourChip() {
  const active = useHappyHours().data?.active ?? []
  if (!active.length) return null
  return (
    <div className="pt-hh">
      {active.map((h) => <Running key={h.id} h={h} />)}
    </div>
  )
}
