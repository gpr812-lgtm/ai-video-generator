import { NextResponse } from 'next/server'
import { getRateLimitStatus } from '@/lib/zai'

export const runtime = 'nodejs'

/**
 * Returns rate-limit status across all configured API keys.
 * ZAI limits each key to 1 request per 10 minutes. With N keys, the app
 * rotates between them, so the effective rate is N requests per 10 minutes.
 */
export async function GET() {
  const status = getRateLimitStatus()
  return NextResponse.json({
    msUntilNextSlot: status.msUntilNextSlot,
    secondsUntilNextSlot: Math.ceil(status.msUntilNextSlot / 1000),
    totalKeys: status.totalKeys,
    activeKeyLabel: status.activeKeyLabel,
    windowMinutes: status.windowMs / 60000,
    keys: status.keys.map((k) => ({
      label: k.label,
      apiKeyPreview: k.apiKeyPreview,
      isDefault: k.isDefault,
      secondsUntilFree: Math.ceil(k.msUntilFree / 1000),
    })),
  })
}
