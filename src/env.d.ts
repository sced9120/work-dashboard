import type { Api } from '../electron/preload/index'

declare global {
  interface Window {
    api: Api
  }
}

export {}
