export type InstallPlatform = 'installed' | 'insecure' | 'ios' | 'prompt' | 'android' | 'other'

export function installPlatform(e: { ua: string; touch: boolean; standalone: boolean; secure: boolean; hasPrompt: boolean }): InstallPlatform {
  if (e.standalone) return 'installed'
  if (!e.secure) return 'insecure'
  if (/iPhone|iPad|iPod/.test(e.ua) || (/Macintosh/.test(e.ua) && e.touch)) return 'ios'
  if (e.hasPrompt) return 'prompt'
  return /Android/.test(e.ua) ? 'android' : 'other'
}
