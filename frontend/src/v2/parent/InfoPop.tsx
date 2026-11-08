import { cloneElement, useCallback, type KeyboardEvent as KE, useEffect, useRef, useState, type HTMLAttributes, type ReactElement, type ReactNode } from 'react'
import { Popover } from '@mantine/core'
import { Icon } from './Icon'

const HOVER = '(hover: hover) and (pointer: fine)'
const LEAVE_MS = 120

/** "i" button with a pop-over: tap toggles, hover opens on mouse devices. */
export function InfoPop({ label, children, target, width }: { label: string; children: ReactNode; target?: ReactElement<HTMLAttributes<HTMLElement>>; width?: number }) {
  const [opened, setOpened] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const hoverable = () => window.matchMedia(HOVER).matches
  const enter = useCallback(() => { clearTimeout(timer.current); if (hoverable()) setOpened(true) }, [])
  const leave = useCallback(() => { if (!hoverable()) return; clearTimeout(timer.current); timer.current = setTimeout(() => setOpened(false), LEAVE_MS) }, [])

  // Mantine only handles Esc while focus is inside the dropdown; focus stays on the button after a tap
  const esc = (e: KE) => { if (e.key === 'Escape' && opened) setOpened(false) }

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      withinPortal
      position="bottom"
      middlewares={{ flip: true, shift: { padding: 16 } }}
      closeOnEscape
      closeOnClickOutside
      returnFocus
    >
      <Popover.Target>
        {/* eslint-disable-next-line react-hooks/refs -- false positive: handlers close over a timer ref but only run in events */}
        {target ? cloneElement(target, { onMouseEnter: enter, onMouseLeave: leave, onKeyDown: esc, onClick: () => setOpened((o) => !o) }) : (
          <button type="button" className="p-info-btn" aria-label={label} aria-expanded={opened} onMouseEnter={enter} onMouseLeave={leave} onKeyDown={esc} onClick={() => setOpened((o) => !o)}>
            <Icon name="info" size={16} />
          </button>
        )}
      </Popover.Target>
      <Popover.Dropdown className="p-pop" maw="calc(100vw - 32px)" w={width} onMouseEnter={enter} onMouseLeave={leave}>
        {children}
      </Popover.Dropdown>
    </Popover>
  )
}
