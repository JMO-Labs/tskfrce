import { ReactNode } from 'react'

export function ListHeader({
  title,
  actions,
  list,
  children,
}: {
  title: string
  /** styling hook for one list's header band (data-list) */
  list?: string
  actions?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="p-list-header" data-list={list}>
      <div className="p-list-header-top">
        <h2>{title}</h2>
        {actions}
      </div>
      {children}
    </div>
  )
}
