import { NextResponse } from 'next/server'
import { probeZaiAvailability } from '@/lib/zai'

export const runtime = 'nodejs'
export const maxDuration = 10

/**
 * Lightweight pre-flight check: is ZAI reachable and not rate-limiting us?
 * Called by the client on page load and before each "Generate" click.
 * Returns { available: boolean, status: number | null }.
 */
export async function GET() {
  try {
    const result = await probeZaiAvailability()
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Probe failed'
    console.error('[zai-probe] error:', message)
    return NextResponse.json(
      { available: false, status: null, error: message },
      { status: 200 }, // 200 so the client always gets JSON, never a network error
    )
  }
}
