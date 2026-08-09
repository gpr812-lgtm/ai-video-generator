import { NextRequest, NextResponse } from 'next/server'
import {
  createVideoTask,
  ZaiRateLimitError,
  ZaiApiError,
  type VideoOptions,
} from '@/lib/zai'

export const runtime = 'nodejs'
// Keep this short: the Caddy gateway times out around 30-60s. If the server
// holds the request open longer (e.g. for retries), Caddy returns 502 and the
// client gets an HTML page instead of JSON ("Unexpected token '<'").
export const maxDuration = 25

interface CreateRequestBody {
  prompt?: string
  imageUrl?: string
  quality?: 'speed' | 'quality'
  withAudio?: boolean
  size?: string
  fps?: number
  duration?: number
}

async function fetchImageAsBase64(url: string): Promise<string> {
  // Hard 10s timeout so this never blocks the route handler beyond the gateway limit.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) {
      throw new Error(`Не удалось скачать изображение (HTTP ${res.status})`)
    }
    const buf = Buffer.from(await res.arrayBuffer())
    return buf.toString('base64')
  } finally {
    clearTimeout(timer)
  }
}

function parseDataUrl(dataUrl: string): string {
  // "data:image/jpeg;base64,XXXX" → "XXXX"
  const idx = dataUrl.indexOf(',')
  return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CreateRequestBody

    if (!body.imageUrl) {
      return NextResponse.json(
        { error: 'Изображение обязательно (imageUrl).' },
        { status: 400 },
      )
    }

    // ZAI's image_url parameter accepts both HTTP URLs and raw base64 bytes.
    // However, in practice ZAI's servers (hosted in China) sometimes cannot
    // fetch images from our preview domain — which results in a FAIL with
    // code 1210 ("API parameter error") during generation.
    // To avoid this, we ALWAYS send the image as raw base64 to ZAI:
    //   • if the client sent a data URL → strip the prefix
    //   • if the client sent an HTTP URL → download it server-side, convert to base64
    let imageBase64: string
    if (body.imageUrl.startsWith('data:')) {
      imageBase64 = parseDataUrl(body.imageUrl)
    } else {
      try {
        imageBase64 = await fetchImageAsBase64(body.imageUrl)
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Ошибка загрузки изображения'
        return NextResponse.json(
          { error: `Не удалось получить изображение: ${msg}` },
          { status: 400 },
        )
      }
    }

    const opts: VideoOptions = {
      prompt: body.prompt?.trim() || undefined,
      imageUrl: imageBase64,
      quality: body.quality === 'quality' ? 'quality' : 'speed',
      withAudio: !!body.withAudio,
      size: body.size || '1920x1080',
      fps: body.fps === 60 ? 60 : 30,
      duration: body.duration === 10 ? 10 : 5,
    }

    const result = await createVideoTask(opts)
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof ZaiRateLimitError) {
      // Tell the client to back off and retry; expose retry hint.
      return NextResponse.json(
        {
          error:
            'Нейросеть сейчас перегружена (слишком много запросов). Попробуйте снова через минуту.',
          retryAfterMs: err.retryAfterMs,
          retryable: true,
        },
        { status: 429 },
      )
    }
    if (err instanceof ZaiApiError) {
      console.error('[video/create] ZAI API error:', err.status, err.rawBody)
      // Return 502 but ALWAYS as JSON (never let Next.js render an HTML error page,
      // which would cause "Unexpected token '<'" on the client).
      return NextResponse.json(
        { error: err.message, retryable: false },
        { status: 502, headers: { 'content-type': 'application/json' } },
      )
    }
    const message = err instanceof Error ? err.message : 'Не удалось создать задачу'
    console.error('[video/create] error:', err)
    return NextResponse.json({ error: message, retryable: false }, { status: 500 })
  }
}
