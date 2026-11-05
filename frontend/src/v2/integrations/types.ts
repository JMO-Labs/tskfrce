/** Mirrors backend/app/api/integrations.py. */
export interface PermissionOut {
  id: string
  text: string
  high_risk: boolean
}

export interface SettingFieldOut {
  key: string
  label: string
  type: 'text' | 'username' | 'number' | 'select'
  options: string[]
  secret: boolean
  required: boolean
}

export interface CatalogItem {
  id: string
  name: string
  developer: string
  description: string
  icon: string
  version: string
  domain: string
  settings: SettingFieldOut[]
  permissions: PermissionOut[]
  widgets: { id: string; surface: 'parent' | 'kid'; title: string }[]
  installed: boolean
}

export type InstallStatus = 'active' | 'paused' | 'revoked' | 'removed'

export interface InstallOut {
  id: number
  source: string
  integration_id: string | null
  name: string
  icon: string
  status: InstallStatus
  paused_reason: string | null
  trusted: boolean
  kid_ids: number[]
  created_at: string
}

export interface InstallDetail extends InstallOut {
  permissions: PermissionOut[]
  kids: { id: number; name: string; kid_widgets: boolean }[]
  chores: { id: number; title: string }[]
  settings: Record<string, string | number>
  domain: string | null
  developer: string | null
}

export interface AuditRow {
  kind: string
  result: string
  reason: string | null
  kid_name: string | null
  chore_title: string | null
  created_at: string
}

export interface InstallBody {
  integration_id: string
  settings: Record<string, string | number>
  kid_ids: number[]
  chore_ids: number[]
  kid_widget_ids: number[]
  accepted_permissions: string[]
}

/** Mirrors backend/app/integrations/widgets.py (already sanitized by the box). */
export type Block =
  | { type: 'card'; title?: string | null; children: Block[] }
  | { type: 'text'; text: string; tone?: 'normal' | 'muted' | 'good' | 'warn'; link?: string | null }
  | { type: 'list'; items: string[] }
  | { type: 'stat'; label: string; value: string }
  | { type: 'progress'; label: string; value: number; max: number }
  | { type: 'image'; url: string; alt: string }
  | { type: 'button'; id: string; label: string; action: string }

export interface WidgetGroup {
  install_id: number
  name: string
  icon: string
  widgets: { id: string; root: Block }[]
}

export type Surface = 'parent' | 'kid'
