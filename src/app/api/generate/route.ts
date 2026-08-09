import { NextRequest, NextResponse } from 'next/server'
import { generateVideo, ProviderError } from '@/lib/providers'

export const runtime = 'nodejs'
export const maxDuration = 300 // 5 minutes — video gen is slow

interface GenerateBody {
  imageUrl?: string
  imageBase64?: string
  prompt?: string
  size?: string
  fps?: number
  duration?: number
  quality?: 'speed' | 'quality'
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as GenerateBody

    if (!body.imageUrl && !body.imageBase64) {
      return NextResponse.json(
        { error: 'Изображение обязательно.' },
        { status: 400 },
      )
    }

    const result = await generateVideo({
      imageUrl: body.imageUrl,
      imageBase64: body.imageBase64,
      prompt: body.prompt,
      size: body.size,
      fps: body.fps,
      duration: body.duration,
      quality: body.quality,
    })

    return NextResponse.json({
      videoUrl: result.videoUrl,
      provider: result.provider,
      elapsedMs: result.elapsedMs,
    })
  } catch (err) {
    if (err instanceof ProviderError) {
      console.error('[generate] all providers failed:', err.message)
      return NextResponse.json(
        { error: err.message, retryable: err.retryable },
        { status: 502 },
      )
    }
    const message = err instanceof Error ? err.message : 'Не удалось сгенерировать видео'
    console.error('[generate] error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
