import { NextRequest, NextResponse } from 'next/server'
import { generateWithColab, getColabUrl } from '@/lib/colab'

export const runtime = 'nodejs'
export const maxDuration = 300 // 5 min for Colab SVD generation

interface GenerateBody {
  imageBase64?: string
  imageUrl?: string
  prompt?: string
  provider?: string // 'colab' | 'local' | 'ai-frames'
  size?: string
  fps?: number
  duration?: number
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as GenerateBody

    if (!body.imageBase64 && !body.imageUrl) {
      return NextResponse.json(
        { error: 'Изображение обязательно.' },
        { status: 400 },
      )
    }

    // Route to specific provider if requested
    const provider = body.provider || 'colab'

    if (provider === 'colab') {
      const colabUrl = getColabUrl()
      if (!colabUrl) {
        return NextResponse.json(
          { error: 'Colab не настроен. Откройте «Провайдеры» и введите Colab URL.' },
          { status: 400 },
        )
      }
      if (!body.imageBase64) {
        return NextResponse.json(
          { error: 'Colab требует imageBase64.' },
          { status: 400 },
        )
      }
      const result = await generateWithColab(body.imageBase64, {
        motionBucketId: 127,
        fps: 6,
        numFrames: 25,
      })
      return NextResponse.json({
        videoUrl: result.videoUrl,
        provider: result.provider,
        elapsedMs: result.elapsedMs,
      })
    }

    return NextResponse.json(
      { error: `Провайдер "${provider}" не поддерживается` },
      { status: 400 },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Не удалось сгенерировать видео'
    console.error('[generate] error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
