import { NextRequest, NextResponse } from 'next/server'
import { createVideoTask, queryVideoStatus, ZaiRateLimitError, ZaiApiError } from '@/lib/zai'
import { stitchVideos } from '@/lib/stitch'
import fs from 'fs'
import path from 'path'

export const runtime = 'nodejs'
export const maxDuration = 300 // 5 min — chunked generation takes longer

interface ChunkedBody {
  imageUrl?: string // data URL
  prompt?: string
  size?: string
  fps?: number
  duration?: number // total desired duration (e.g. 30)
  quality?: 'speed' | 'quality'
  withAudio?: boolean
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ChunkedBody

    if (!body.imageUrl) {
      return NextResponse.json({ error: 'Изображение обязательно.' }, { status: 400 })
    }

    const totalDuration = body.duration || 5
    const chunkSize = 5 // ZAI max per task is 5-10s, use 5 for reliability
    const numChunks = Math.ceil(totalDuration / chunkSize)

    // Parse image base64 from data URL
    let imageBase64: string
    if (body.imageUrl.startsWith('data:')) {
      const idx = body.imageUrl.indexOf(',')
      imageBase64 = idx >= 0 ? body.imageUrl.slice(idx + 1) : body.imageUrl
    } else {
      imageBase64 = body.imageUrl
    }

    console.log(`[chunked] generating ${numChunks} chunks of ${chunkSize}s each (total ${totalDuration}s)`)

    const videoUrls: string[] = []
    const errors: string[] = []

    // Generate each chunk sequentially (ZAI has rate limit)
    for (let i = 0; i < numChunks; i++) {
      console.log(`[chunked] chunk ${i + 1}/${numChunks}`)

      // Vary prompt slightly for each chunk to create motion progression
      const chunkPrompt = body.prompt
        ? `${body.prompt}, part ${i + 1} of ${numChunks}, continuous motion`
        : `cinematic scene, part ${i + 1} of ${numChunks}, continuous motion`

      let taskId: string | null = null

      // Try to create task — if rate limited, wait and retry
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const result = await createVideoTask({
            prompt: chunkPrompt,
            imageUrl: imageBase64,
            quality: body.quality || 'speed',
            withAudio: false,
            size: body.size || '1280x720',
            fps: body.fps || 30,
            duration: chunkSize,
          })
          taskId = result.taskId
          break
        } catch (err) {
          if (err instanceof ZaiRateLimitError) {
            console.log(`[chunked] chunk ${i + 1} rate limited, waiting 60s...`)
            await sleep(60000) // Wait 60s before retry
          } else {
            throw err
          }
        }
      }

      if (!taskId) {
        errors.push(`Chunk ${i + 1}: не удалось создать задачу`)
        continue
      }

      // Poll for completion
      let videoUrl: string | null = null
      for (let poll = 0; poll < 30; poll++) {
        await sleep(5000)
        const status = await queryVideoStatus(taskId)
        if (status.status === 'SUCCESS' && status.videoUrl) {
          videoUrl = status.videoUrl
          break
        }
        if (status.status === 'FAIL') {
          errors.push(`Chunk ${i + 1}: ${status.errorMessage || 'FAIL'}`)
          break
        }
      }

      if (videoUrl) {
        videoUrls.push(videoUrl)
        console.log(`[chunked] chunk ${i + 1} done: ${videoUrl}`)
      }
    }

    if (videoUrls.length === 0) {
      return NextResponse.json(
        { error: `Не удалось сгенерировать ни одного сегмента. ${errors.join('; ')}` },
        { status: 502 },
      )
    }

    // If only one chunk, return it directly
    if (videoUrls.length === 1) {
      return NextResponse.json({
        videoUrl: videoUrls[0],
        provider: 'zai-chunked',
        chunks: 1,
        totalDuration: chunkSize,
      })
    }

    // Stitch all chunks into one video
    const uploadsDir = path.join(process.cwd(), 'public', 'uploads')
    await fs.promises.mkdir(uploadsDir, { recursive: true })
    const outputPath = path.join(uploadsDir, `chunked-${Date.now()}.mp4`)

    await stitchVideos(videoUrls, outputPath)

    return NextResponse.json({
      videoUrl: `/uploads/${path.basename(outputPath)}`,
      provider: 'zai-chunked',
      chunks: videoUrls.length,
      totalDuration: videoUrls.length * chunkSize,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Chunked generation failed'
    console.error('[chunked] error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
