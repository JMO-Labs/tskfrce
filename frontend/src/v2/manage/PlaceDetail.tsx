import { useState } from 'react'
import { Switch } from '@mantine/core'
import { useDeletePlace, usePatchPlace, useTestPlace, type NotifyEvent, type Place } from '@/v2/hooks/useNotify'
import { Icon } from '@/v2/parent/Icon'
import { toastFail, toastOk, toasted } from '@/v2/notify'
import { ConfirmDelete } from './ConfirmDelete'
import { PlaceForm } from './PlaceForm'

/** The place's on/off switch, for the row `aside`. Disabled while its save runs, so a click is never lost. */
export function PlaceSwitch({ place }: { place: Place }) {
  const patch = usePatchPlace()
  return (
    <Switch
      className="pn-sw"
      aria-label={`${place.name} notifications on`}
      checked={place.enabled}
      disabled={patch.isPending}
      onChange={(e) => void toasted(patch.mutateAsync({ id: place.id, enabled: e.currentTarget.checked }), 'Saved')}
    />
  )
}

/** Row body for one place: masked address with a test button, the events it gets, Edit and Delete. */
export function PlaceDetail({ place, events }: { place: Place; events: NotifyEvent[] }) {
  const patch = usePatchPlace()
  const del = useDeletePlace()
  const test = useTestPlace()
  const [confirm, setConfirm] = useState(false)
  const [edit, setEdit] = useState(false)
  const toggle = (key: string) =>
    void toasted(
      patch.mutateAsync({ id: place.id, events: place.events.includes(key) ? place.events.filter((e) => e !== key) : [...place.events, key] }),
      'Saved',
    )
  const runTest = () =>
    test.mutate(place.id, {
      onSuccess: (r) => (r.ok ? toastOk('Test sent') : toastFail(new Error(r.error ?? 'The test did not send.'))),
      onError: toastFail,
    })

  return (
    <>
      <div className="pn-inp">
        <Icon name="key" size={16} />
        <span className="pn-mask">{place.url_mask}</span>
        <button type="button" className="p-btn pn-test" onClick={runTest} disabled={test.isPending}>
          Test
        </button>
      </div>
      <span className="pk-label" id={`pn-sends-${place.id}`}>Sends</span>
      <div className="pn-evs" role="group" aria-labelledby={`pn-sends-${place.id}`}>
        {events.map((ev) => (
          <button key={ev.key} type="button" className="pn-ev" aria-pressed={place.events.includes(ev.key)} disabled={patch.isPending} onClick={() => toggle(ev.key)}>
            {ev.label}
          </button>
        ))}
      </div>
      <div className="pn-acts">
        <button type="button" className="p-btn" onClick={() => setEdit(true)}>
          {place.readable ? 'Edit' : 'Change address'}
        </button>
        <button type="button" className="p-btn" data-variant="red" onClick={() => setConfirm(true)}>
          <Icon name="delete" size={17} />
          Delete place
        </button>
      </div>
      <ConfirmDelete
        opened={confirm}
        title="Delete this place?"
        body="t@sk4ce will stop sending pings there."
        onConfirm={() => void del.mutateAsync(place.id).then(() => toastOk('Deleted'), toastFail)}
        onClose={() => setConfirm(false)}
      />
      <PlaceForm opened={edit} onClose={() => setEdit(false)} place={place} />
    </>
  )
}
