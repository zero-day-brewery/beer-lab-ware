'use client'
import { useEffect } from 'react'
import { seedDefaults } from '@/lib/db/seed'
import { reportDbError } from '@/lib/diagnostics/error-log'

export function SeedOnMount() {
  useEffect(() => {
    seedDefaults().catch((err) => {
      reportDbError('seed', err)
    })
  }, [])

  return null
}
