import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import type { NextConfig } from 'next'

const pkg = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string }

function gitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'local'
  }
}

const nextConfig: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: true,
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_BUILD_SHA: gitSha(),
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
}

export default nextConfig
