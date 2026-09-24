import type { DesktopApi } from '../shared/contracts'

declare global {
  interface Window { mdedit: DesktopApi }
}

export {}
