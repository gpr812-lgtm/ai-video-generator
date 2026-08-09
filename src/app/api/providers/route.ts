import { NextRequest, NextResponse } from 'next/server'
import { listProviders, setProviderKey, getProviderKeys } from '@/lib/providers'

export const runtime = 'nodejs'

/**
 * GET /api/providers — list all available video generation providers
 * with their configuration status.
 */
export async function GET() {
  return NextResponse.json({
    providers: listProviders(),
    keys: Object.keys(getProviderKeys()).filter(Boolean),
  })
}

/**
 * POST /api/providers — set or update a provider API key.
 * Body: { provider: 'replicate'|'segmind'|'huggingface', key: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const validProviders = ['replicate', 'segmind', 'huggingface']
    if (!validProviders.includes(body?.provider)) {
      return NextResponse.json(
        { error: 'Неверный провайдер. Доступны: ' + validProviders.join(', ') },
        { status: 400 },
      )
    }
    setProviderKey(body.provider, body.key || '')
    return NextResponse.json({
      ok: true,
      providers: listProviders(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to set key'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
