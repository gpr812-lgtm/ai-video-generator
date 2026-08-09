import { NextRequest, NextResponse } from 'next/server'
import { listKeys, addKey, removeKey } from '@/lib/zai'

export const runtime = 'nodejs'

/**
 * GET /api/keys — list all configured API keys (with previews, not full keys).
 */
export async function GET() {
  try {
    const keys = listKeys()
    return NextResponse.json({ keys })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list keys'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * POST /api/keys — add a new API key.
 * Body: { apiKey: string, token?: string, label?: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    if (!body?.apiKey) {
      return NextResponse.json(
        { error: 'apiKey обязателен' },
        { status: 400 },
      )
    }
    addKey(body.apiKey, body.token, body.label)
    return NextResponse.json({ ok: true, keys: listKeys() })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to add key'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

/**
 * DELETE /api/keys — remove an API key.
 * Body: { apiKey: string }
 */
export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json()
    if (!body?.apiKey) {
      return NextResponse.json(
        { error: 'apiKey обязателен' },
        { status: 400 },
      )
    }
    removeKey(body.apiKey)
    return NextResponse.json({ ok: true, keys: listKeys() })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to remove key'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
