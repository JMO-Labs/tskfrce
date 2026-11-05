import type { ReactNode } from 'react'
import { Icon } from '@/v2/parent/Icon'
import { useIntegrationWidgets, usePressButton } from '@/v2/hooks/useIntegrationWidgets'
import { WidgetBlocks } from './WidgetBlocks'
import type { Surface, WidgetGroup } from './types'

/** Always names the integration, so a widget can't pass as core UI. Content can't hide this header. */
export function WidgetFrame({ group, children, surface = 'parent' }: { group: WidgetGroup; children: ReactNode; surface?: Surface }) {
  const kid = surface === 'kid'
  return (
    <section className="iw-frame" data-surface={surface} aria-label={`${group.name} integration`}>
      <header className="iw-head">
        <span className="ig-icon iw-icon">
          <Icon name={group.icon || 'extension'} size={20} />
        </span>
        <span className="iw-name">{group.name}</span>
        {kid ? (
          <span className="k-chip" data-tone="later">
            Integration
          </span>
        ) : (
          <span className="p-chip" data-tone="grey">
            Integration
          </span>
        )}
      </header>
      <div className="iw-body">{children}</div>
    </section>
  )
}

function Group({ group, surface }: { group: WidgetGroup; surface: Surface }) {
  const press = usePressButton(group.install_id, surface)
  return (
    <WidgetFrame group={group} surface={surface}>
      {group.widgets.map((w) => (
        <WidgetBlocks
          key={w.id}
          block={w.root}
          pending={press.isPending}
          kid={surface === 'kid'}
          onPress={(button_id) => press.mutate({ widget_id: w.id, button_id })}
        />
      ))}
    </WidgetFrame>
  )
}

/** Integration widgets for a surface. Renders nothing when there are none or the fetch fails. */
export function IntegrationWidgets({ surface }: { surface: Surface }) {
  const { data, isError } = useIntegrationWidgets(surface)
  if (isError || !data?.length) return null
  return (
    <div className="iw-list" data-surface={surface}>
      {data.map((g) => (
        <Group key={g.install_id} group={g} surface={surface} />
      ))}
    </div>
  )
}
