import { useState } from 'react'
import { TextInput } from '@mantine/core'
import { useHomeworkSite } from '@/v2/hooks/useHomework'
import { errorText } from '@/v2/errorText'
import { Icon } from '@/v2/parent/Icon'

interface Props {
  label: string
  domains: string[]
  kind: 'allow' | 'block'
  kidId?: number
  empty: string
}

/** One editable site list: domains with a remove button, plus an add box. Pasted URLs go to the server raw (it normalises). */
export function SiteGroup({ label, domains, kind, kidId, empty }: Props) {
  const site = useHomeworkSite()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const run = (action: 'add' | 'remove', domain: string) => {
    setError(null)
    return site.mutateAsync({ action, domain, kind, kid_id: kidId }).then(
      () => action === 'add' && setText(''),
      (e) => setError(errorText(e)),
    )
  }
  return (
    <div role="group" aria-label={label}>
      {domains.length === 0 && <p className="pk-hint">{empty}</p>}
      {domains.map((d) => (
        <div key={d} className="pk-line">
          <b>{d}</b>
          <button type="button" className="p-btn" aria-label={`Remove ${d}`} disabled={site.isPending} onClick={() => run('remove', d)}>
            <Icon name="close" size={16} />
          </button>
        </div>
      ))}
      <form
        className="pk-line"
        onSubmit={(e) => {
          e.preventDefault()
          if (text.trim()) void run('add', text.trim())
        }}
      >
        <TextInput aria-label={`Add to ${label}`} placeholder="school.edu or paste a link" value={text} maxLength={2048} onChange={(e) => setText(e.currentTarget.value)} />
        <button type="submit" className="p-btn" data-variant="accent" disabled={!text.trim() || site.isPending}>
          Add
        </button>
      </form>
      {error && (
        <p role="alert" className="pk-hint">
          {error}
        </p>
      )}
    </div>
  )
}
