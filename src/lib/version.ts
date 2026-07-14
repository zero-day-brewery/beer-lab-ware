export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? '0.0.0-dev'
export const BUILD_SHA = process.env.NEXT_PUBLIC_BUILD_SHA ?? 'local'
export const BUILD_TIME = process.env.NEXT_PUBLIC_BUILD_TIME ?? ''

export interface AppVersion {
  version: string
  sha: string
  builtAt: string
}

export function getAppVersion(): AppVersion {
  return { version: APP_VERSION, sha: BUILD_SHA, builtAt: BUILD_TIME }
}
