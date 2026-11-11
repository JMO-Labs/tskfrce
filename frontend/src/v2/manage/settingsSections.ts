import type { SettingsSection } from './SettingsList'

export type S = 'family' | 'hours' | 'notifications' | 'look' | 'gifs' | 'homework' | 'parents' | 'integrations'

/** The settings sections (spec mockup 02): one list for the Settings page and the phone More page. */
export const SETTINGS_SECTIONS: SettingsSection<S>[] = [
  { id: 'family', label: 'Family', description: 'Name, time zone, bedtime, recap, points rules', icon: 'home' },
  { id: 'hours', label: 'Hours', description: 'School nights, weekends', icon: 'schedule' },
  { id: 'notifications', label: 'Notifications', description: 'Chat app pings, quiet hours, kid phones', icon: 'notifications' },
  { id: 'look', label: 'Appearance', description: 'Accent colour, dark mode', icon: 'palette' },
  { id: 'gifs', label: 'GIFs', description: 'Chat GIF search', icon: 'gif_box' },
  { id: 'homework', label: 'Homework', description: 'Sites that work in homework mode', icon: 'menu_book' },
  { id: 'parents', label: 'Parents', description: 'Invite and manage parents', icon: 'supervisor_account' },
  { id: 'integrations', label: 'Integrations', description: 'Connect other apps', icon: 'extension' },
]
