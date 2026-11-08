import { useId, useState, type ReactNode } from 'react'
import { Icon } from '../parent/Icon'

/** Mockup `.tip`: dashed one-liner (icon, sentence, "More", dismiss). `children` open in place under More. */
export function TipLine({ icon, text, onDismiss, label = 'Tip', children }: { icon: string; text: ReactNode; onDismiss: () => void; label?: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <section className="pt-tip" aria-label={label} data-open={open ? '' : undefined}>
      <div className="pt-tip-row">
        <Icon name={icon} size={18} />
        <span className="pt-tip-t">{text}</span>
        {children && (
          <button type="button" className="pt-tip-more" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
            More
          </button>
        )}
        <button type="button" className="pt-tip-x" aria-label="Dismiss tip" onClick={onDismiss}>
          <Icon name="close" size={16} />
        </button>
      </div>
      {open && children && <div id={id} className="pt-tip-body">{children}</div>}
    </section>
  )
}
