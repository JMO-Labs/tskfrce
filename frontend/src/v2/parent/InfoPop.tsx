import { cloneElement, useCallback, useEffect, useRef, useState } from 'react'
import type { HTMLAttributes, KeyboardEvent, MouseEvent, ReactElement, ReactNode } from 'react'
import { Popover } from '@mantine/core'
import { Icon } from './Icon'
import { motionProps } from './reduceMotion'

const HOVER = '(hover: hover) and (pointer: fine)'
const LEAVE_MS = 120

/** "i" button with a pop-over: tap toggles, hover opens on mouse devices. Children may be a function that gets `close` (focus returns to the trigger). */
export function InfoPop({ label, children, target, width }: { label: string; children: ReactNode | ((close: () => void) => ReactNode); target?: ReactElement<HTMLAttributes<HTMLElement>>; width?: number }) {
  const [opened, setOpened] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const byHover = useRef(false) // opened by mouse hover; the click that follows must not close it
  const hoverable = () => window.matchMedia(HOVER).matches
  const enter = useCallback(() => { clearTimeout(timer.current); if (hoverable()) { byHover.current = true; setOpened(true) } }, [])
  const leave = useCallback(() => { if (!hoverable()) return; clearTimeout(timer.current); timer.current = setTimeout(() => setOpened(false), LEAVE_MS) }, [])

  // Mantine only handles Esc while focus is inside the dropdown; focus stays on the button after a tap
  const esc = (e: KeyboardEvent<HTMLElement>) => { if (e.key === 'Escape' && opened) setOpened(false) }
  const click = () => {
    if (opened && byHover.current && hoverable()) { byHover.current = false; return }
    byHover.current = false
    setOpened((o) => !o)
  }

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
      transitionProps={motionProps()}
    >
      <Popover.Target>
        {/* eslint-disable-next-line react-hooks/refs -- false positive: handlers close over a timer ref but only run in events */}
        {target ? cloneElement(target, {
          onMouseEnter: (e: MouseEvent<HTMLElement>) => { target.props.onMouseEnter?.(e); enter() },
          onMouseLeave: (e: MouseEvent<HTMLElement>) => { target.props.onMouseLeave?.(e); leave() },
          onKeyDown: (e: KeyboardEvent<HTMLElement>) => { target.props.onKeyDown?.(e); esc(e) },
          onClick: (e: MouseEvent<HTMLElement>) => { target.props.onClick?.(e); click() },
          'aria-expanded': opened,
        }) : (
          <button type="button" className="p-info-btn" aria-label={label} aria-expanded={opened} onMouseEnter={enter} onMouseLeave={leave} onKeyDown={esc} onClick={click}>
            <Icon name="info" size={16} />
          </button>
        )}
      </Popover.Target>
      <Popover.Dropdown className="p-pop" maw="calc(100vw - 32px)" w={width} onMouseEnter={enter} onMouseLeave={leave}>
        {typeof children === 'function' ? children(() => setOpened(false)) : children}
      </Popover.Dropdown>
    </Popover>
  )
}
