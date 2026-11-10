import { useEffect, useState } from 'react'
import { Modal, TextInput } from '@mantine/core'
import { useAddPlace, usePatchPlace, type Place } from '@/v2/hooks/useNotify'
import { Icon } from '@/v2/parent/Icon'
import { InfoPop } from '@/v2/parent/InfoPop'
import { toastFail, toastOk } from '@/v2/notify'

interface Props {
  opened: boolean
  onClose: () => void
  /** Edit mode: only the address can change. */
  place?: Place
}

/** Add a place, or re-enter the address of one. */
export function PlaceForm({ opened, onClose, place }: Props) {
  const add = useAddPlace()
  const patch = usePatchPlace()
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [wasOpened, setWasOpened] = useState(opened)
  if (opened !== wasOpened) {
    setWasOpened(opened)
    if (opened) {
      setName('')
      setUrl('')
    }
  }
  const busy = add.isPending || patch.isPending
  const ready = url.trim() !== '' && (place !== undefined || name.trim() !== '')
  const done = () => {
    toastOk('Saved')
    onClose()
  }
  const save = () => {
    if (!ready || busy) return
    if (place) patch.mutate({ id: place.id, url: url.trim() }, { onSuccess: done, onError: toastFail })
    else add.mutate({ name: name.trim(), url: url.trim() }, { onSuccess: done, onError: toastFail })
  }
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={place ? 'Change address' : 'Add a place'}
      centered
      zIndex={400}
      styles={{ title: { fontWeight: 700, color: 'var(--p-ink)' } }}
    >
      <form
        className="pn-form"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        {!place && (
          <TextInput label="Name" maxLength={60} value={name} onChange={(e) => setName(e.currentTarget.value)} data-autofocus />
        )}
        <TextInput
          label="Place address"
          description="Like discord://webhook_id/token."
          rightSection={
            <InfoPop label="About place addresses" width={280}>
              <p className="ch-pop-p">Alerts go out through Apprise, a free tool that works with Signal, Discord, email and many more. Its wiki shows the address to use for each app.</p>
            </InfoPop>
          }
          rightSectionPointerEvents="all"
          rightSectionWidth={44}
          maxLength={1000}
          autoComplete="off"
          spellCheck={false}
          value={url}
          onChange={(e) => setUrl(e.currentTarget.value)}
          data-autofocus={place ? true : undefined}
        />
        <div className="pk-actions">
          <button type="button" className="p-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="p-btn" data-variant="accent" disabled={!ready || busy}>
            <Icon name="check" size={16} />
            Save
          </button>
        </div>
      </form>
    </Modal>
  )
}
