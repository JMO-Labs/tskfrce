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
