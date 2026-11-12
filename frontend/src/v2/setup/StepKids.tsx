import { useState, type KeyboardEvent } from 'react'
import { Button, Popover, TextInput } from '@mantine/core'
import { useMutation } from '@tanstack/react-query'
import { api } from '../api'
import { useSingleFlight } from '../hooks/useSingleFlight'
import { errorText } from '../errorText'
import { Icon } from '../parent/Icon'
import { InfoPop } from '../parent/InfoPop'
import { motionProps } from '../parent/reduceMotion'
import type { Kid } from '../types'
import { BirthdayField, fromMonthValue } from '../manage/BirthdayField'
import { AVATARS } from './starterChores'
import styles from './stepCards.module.css'

interface Props {
  kids: Kid[]
  name: string
  onName: (v: string) => void
  draftError?: string
  onAdd: (k: Kid) => void
}

export function StepKids({ kids, name, onName, draftError, onAdd }: Props) {
  const [avatar, setAvatar] = useState(AVATARS[0])
  const [picking, setPicking] = useState(false)
  const [pin, setPin] = useState('')
  const [born, setBorn] = useState('')
  const pinBad = pin !== '' && !/^\d{4}$/.test(pin)
  const add = useMutation({
    mutationFn: () =>
      api<Kid>('/kids', { method: 'POST', body: { full_name: name.trim(), avatar, pin: pin || null, ...(born ? fromMonthValue(born) : {}) } }),
    onSuccess: (k) => {
      onAdd(k)
      onName('')
      setPin('')
      setBorn('')
    },
  })
  const once = useSingleFlight()
  const addKid = () => void once(() => add.mutateAsync().catch(() => {})) // errors show via add.error
  const canAdd = !!name.trim() && !pinBad && !add.isPending
  const enterAdds = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || !name.trim()) return
    e.preventDefault() // would otherwise submit the wizard form
    if (canAdd) addKid()
  }
  return (
    <>
      {kids.length > 0 && (
        <div className={styles.list} aria-label="Kids added" role="list">
          {kids.map((k) => (
            <div key={k.id} role="listitem" className={styles.kidline}>
              <span className={styles.avsm} aria-hidden="true">{k.avatar || (k.full_name ?? '').charAt(0).toUpperCase()}</span>
              <span className={styles.kn}>{k.full_name}</span>
              <span className={styles.pinnote}>{k.has_pin ? 'PIN set' : 'No PIN'}</span>
              <span className={styles.chip}><Icon name="check" size={11} /> Added</span>
            </div>
          ))}
        </div>
      )}
      <div className={styles.card}>
        <TextInput label="Name" placeholder="Kid's name" autoComplete="off" value={name} onChange={(e) => onName(e.currentTarget.value)} onKeyDown={enterAdds} error={draftError} />
        <div className={styles.pair}>
          <div>
            <div className={styles.fldlabel}>Avatar</div>
            <Popover opened={picking} onChange={setPicking} withinPortal position="bottom-start" middlewares={{ flip: true, shift: { padding: 16 } }} closeOnEscape closeOnClickOutside trapFocus returnFocus transitionProps={motionProps()}>
              <Popover.Target>
                <button type="button" className={styles.avbtn} aria-label={`Pick an avatar, now ${avatar}`} aria-expanded={picking}
                  onClick={() => setPicking((o) => !o)}>
                  <span aria-hidden="true">{avatar}</span><Icon name="expand_more" size={14} />
                </button>
              </Popover.Target>
              <Popover.Dropdown className="p-pop" maw="calc(100vw - 32px)">
                <div className={styles.avtitle} aria-hidden="true">Pick an avatar</div>
                <div className={styles.avgrid} role="group" aria-label="Pick an avatar">
                  {AVATARS.map((a) => (
                    <button key={a} type="button" aria-pressed={a === avatar} aria-label={`Avatar ${a}`} onClick={() => { setAvatar(a); setPicking(false) }}>{a}</button>
                  ))}
                </div>
              </Popover.Dropdown>
            </Popover>
          </div>
          <TextInput style={{ flex: 1, minWidth: 0 }} placeholder="4 digits" autoComplete="off" inputMode="numeric" maxLength={4} value={pin}
            label={<span className={styles.pinlabel}>PIN (optional) <InfoPop label="About PINs" width={260}>4 digits. Lets a kid prove it&apos;s them on a shared device.</InfoPop></span>}
            onChange={(e) => setPin(e.currentTarget.value)} onKeyDown={enterAdds} error={pinBad} />
        </div>
        <div>
          <div className={styles.fldlabel}>Birthday (optional)</div>
          <BirthdayField className={styles.avbtn} value={born} onChange={setBorn} />
        </div>
        {pinBad && <p role="alert" className={styles.pinerr}>Use exactly 4 digits.</p>}
        {add.error && <p role="alert">Couldn&apos;t add that kid. {errorText(add.error)}</p>}
        <div className={styles.actbar}>
          <Button variant="filled" leftSection={<Icon name="add" size={14} />} disabled={!name.trim() || pinBad} loading={add.isPending} onClick={addKid}>Add kid</Button>
        </div>
      </div>
    </>
  )
}
