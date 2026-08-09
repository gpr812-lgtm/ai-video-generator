import { NextRequest, NextResponse } from 'next/server'
import { saveColabUrl, getColabUrl, checkColabStatus } from '@/lib/colab'

export const runtime = 'nodejs'
export const maxDuration = 15

/**
 * GET /api/colab — check Colab connection status
 * POST /api/colab — save Colab URL { url: string }
 */
export async function GET() {
  const status = await checkColabStatus()
  return NextResponse.json(status)
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const url = body?.url?.trim()
    if (!url) {
      return NextResponse.json({ error: 'URL обязателен' }, { status: 400 })
    }
    // Basic URL validation
    try {
      new URL(url)
    } catch {
      return NextResponse.json({ error: 'Некорректный URL' }, { status: 400 })
    }
    saveColabUrl(url)
    // Check if it's actually reachable
    const status = await checkColabStatus()
    return NextResponse.json({
      ok: true,
      url,
      connected: status.connected,
      model: status.model,
      gpu: status.gpu,
      error: status.error,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
