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

// Optional deploy-time base path (e.g. BASE_PATH=/beer-lab-ware for a GitHub
// Pages project site or any subpath self-host). Empty = root deploy (default).
const basePath = process.env.BASE_PATH ?? ''

const nextConfig: NextConfig = {
  output: 'export',
  ...(basePath ? { basePath } : {}),
  images: { unoptimized: true },
  trailingSlash: true,
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_BUILD_SHA: gitSha(),
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
}

export default nextConfig
