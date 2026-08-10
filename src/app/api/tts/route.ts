import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'

export const runtime = 'nodejs'
export const maxDuration = 30

/**
 * Generate natural Russian voiceover using ZAI TTS API (glm-tts).
 * Much better quality than browser SpeechSynthesis.
 */

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { text, voice } = body as { text: string; voice?: string }

    if (!text || !text.trim()) {
      return NextResponse.json({ error: 'Текст обязателен' }, { status: 400 })
    }

    const zai = await ZAI.create()

    const ttsVoice = voice || 'tongtong'

    const response = await zai.audio.tts.create({
      input: text.trim(),
      voice: ttsVoice,
      speed: 1.0,
      response_format: 'wav',
      stream: false,
    })

    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(new Uint8Array(arrayBuffer))

    const fs = await import('fs')
    const path = await import('path')
    const uploadsDir = path.join(process.cwd(), 'public', 'uploads')
    await fs.promises.mkdir(uploadsDir, { recursive: true })
    const filename = `tts-${Date.now()}.wav`
    const filepath = path.join(uploadsDir, filename)
    await fs.promises.writeFile(filepath, buffer)

    return NextResponse.json({
      audioUrl: `/uploads/${filename}`,
      voice: ttsVoice,
    })
  } catch (err) {
    console.error('[tts] error:', err)
    const message = err instanceof Error ? err.message : 'TTS failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
