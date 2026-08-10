import { NextRequest, NextResponse } from 'next/server'
import { createVideoTask, ZaiRateLimitError, ZaiApiError } from '@/lib/zai'

export const runtime = 'nodejs'
export const maxDuration = 25 // Quick — just creates the task, doesn't wait

interface CreateRequestBody {
  prompt?: string
  imageUrl?: string
  quality?: 'speed' | 'quality'
  withAudio?: boolean
  size?: string
  fps?: number
  duration?: number
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

    // Convert data URL or HTTP URL to base64 for ZAI
    let imageBase64: string
    if (body.imageUrl.startsWith('data:')) {
      const idx = body.imageUrl.indexOf(',')
      imageBase64 = idx >= 0 ? body.imageUrl.slice(idx + 1) : body.imageUrl
    } else {
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 8000)
        const res = await fetch(body.imageUrl, { signal: controller.signal })
        clearTimeout(timer)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const buf = Buffer.from(await res.arrayBuffer())
        imageBase64 = buf.toString('base64')
      } catch (e) {
        return NextResponse.json(
          { error: `Не удалось получить изображение: ${e instanceof Error ? e.message : 'error'}` },
          { status: 400 },
        )
      }
    }

    const result = await createVideoTask({
      prompt: body.prompt?.trim() || undefined,
      imageUrl: imageBase64,
      quality: body.quality === 'quality' ? 'quality' : 'speed',
      withAudio: !!body.withAudio,
      size: body.size || '1280x720',
      fps: body.fps === 60 ? 60 : 30,
      duration: Math.min(body.duration || 5, 10), // ZAI max 10s per task
    })

    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof ZaiRateLimitError) {
      return NextResponse.json(
        {
          error: 'ZAI лимит: 1 запрос в 10 минут. Подождите и попробуйте снова.',
          retryAfterMs: err.retryAfterMs,
          retryable: true,
        },
        { status: 429 },
      )
    }
    if (err instanceof ZaiApiError) {
      return NextResponse.json(
        { error: err.message, retryable: false },
        { status: 502 },
      )
    }
    const message = err instanceof Error ? err.message : 'Не удалось создать задачу'
    console.error('[video/create] error:', err)
    return NextResponse.json({ error: message, retryable: false }, { status: 500 })
  }
}
