import { NextRequest, NextResponse } from 'next/server'
import { generateLocalVideo } from '@/lib/local-video'
import { generateWithColab, getColabUrl } from '@/lib/colab'

export const runtime = 'nodejs'
export const maxDuration = 120

interface GenerateBody {
  imageBase64?: string
  imageUrl?: string
  prompt?: string
  provider?: string
  duration?: number
  size?: string
  fps?: number
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

    const provider = body.provider || 'local'

    // Local ffmpeg (instant, Ken Burns effect)
    if (provider === 'local') {
      if (!body.imageBase64) {
        return NextResponse.json({ error: 'imageBase64 required for local' }, { status: 400 })
      }
      const buf = Buffer.from(body.imageBase64, 'base64')
      const prompt = (body.prompt || '').toLowerCase()
      let motion: 'zoom-in' | 'zoom-out' | 'pan-right' | 'pan-left' | 'zoom-pan' = 'zoom-pan'
      if (prompt.includes('zoom') && prompt.includes('out')) motion = 'zoom-out'
      else if (prompt.includes('zoom')) motion = 'zoom-in'
      else if (prompt.includes('pan') && (prompt.includes('right') || prompt.includes('вправ'))) motion = 'pan-right'
      else if (prompt.includes('pan') && (prompt.includes('left') || prompt.includes('влев'))) motion = 'pan-left'

      const result = await generateLocalVideo(buf, {
        duration: body.duration || 5,
        fps: 25,
        motion,
      })
      return NextResponse.json({
        videoUrl: result.videoUrl,
        provider: 'local-ffmpeg',
        elapsedMs: result.elapsedMs,
      })
    }

    // Colab SVD
    if (provider === 'colab') {
      const colabUrl = getColabUrl()
      if (!colabUrl) {
        return NextResponse.json({ error: 'Colab не настроен' }, { status: 400 })
      }
      if (!body.imageBase64) {
        return NextResponse.json({ error: 'imageBase64 required' }, { status: 400 })
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

    return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 400 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed'
    console.error('[generate] error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
