import { NextRequest, NextResponse } from 'next/server'
import { createVideoTask, queryVideoStatus, ZaiRateLimitError, ZaiApiError } from '@/lib/zai'
import { stitchVideos } from '@/lib/stitch'
import fs from 'fs'
import path from 'path'

export const runtime = 'nodejs'
export const maxDuration = 25 // Quick — just creates the first chunk task

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface ChunkedBody {
  imageUrl?: string
  prompt?: string
  size?: string
  fps?: number
  duration?: number
  quality?: 'speed' | 'quality'
}

// In-memory storage for chunked generation sessions
interface ChunkSession {
  id: string
  totalChunks: number
  currentChunk: number
  videoUrls: string[]
  status: 'creating' | 'processing' | 'stitching' | 'done' | 'error'
  error?: string
  finalVideoUrl?: string
  imageBase64: string
  prompt?: string
  size?: string
  fps?: number
  quality?: string
}

const sessions = new Map<string, ChunkSession>()

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ChunkedBody

    if (!body.imageUrl) {
      return NextResponse.json({ error: 'Изображение обязательно.' }, { status: 400 })
    }

    const totalDuration = body.duration || 5
    const chunkSize = 5
    const numChunks = Math.ceil(totalDuration / chunkSize)

    // Parse image base64
    let imageBase64: string
    if (body.imageUrl.startsWith('data:')) {
      const idx = body.imageUrl.indexOf(',')
      imageBase64 = idx >= 0 ? body.imageUrl.slice(idx + 1) : body.imageUrl
    } else {
      imageBase64 = body.imageUrl
    }

    // Create session
    const sessionId = `chunk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const session: ChunkSession = {
      id: sessionId,
      totalChunks: numChunks,
      currentChunk: 0,
      videoUrls: [],
      status: 'creating',
      imageBase64,
      prompt: body.prompt,
      size: body.size || '1280x720',
      fps: body.fps || 30,
      quality: body.quality || 'speed',
    }
    sessions.set(sessionId, session)

    // Start background generation (doesn't block the response)
    generateChunksInBackground(sessionId).catch((err) => {
      console.error(`[chunked] background error:`, err)
      session.status = 'error'
      session.error = err instanceof Error ? err.message : 'Unknown error'
    })

    // Return immediately with session ID
    return NextResponse.json({
      sessionId,
      totalChunks: numChunks,
      totalDuration,
      status: 'creating',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Chunked generation failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// GET — poll session status
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId')
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  }
  const session = sessions.get(sessionId)
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }
  return NextResponse.json({
    sessionId,
    status: session.status,
    currentChunk: session.currentChunk,
    totalChunks: session.totalChunks,
    videoUrl: session.finalVideoUrl,
    error: session.error,
  })
}

// Background chunk generation
async function generateChunksInBackground(sessionId: string) {
  const session = sessions.get(sessionId)
  if (!session) return

  for (let i = 0; i < session.totalChunks; i++) {
    session.currentChunk = i + 1
    session.status = 'processing'

    const chunkPrompt = session.prompt
      ? `${session.prompt}, part ${i + 1} of ${session.totalChunks}, continuous motion`
      : `cinematic scene, part ${i + 1} of ${session.totalChunks}, continuous motion`

    // Create ZAI task for this chunk
    let taskId: string | null = null
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const result = await createVideoTask({
          prompt: chunkPrompt,
          imageUrl: session.imageBase64,
          quality: (session.quality as 'speed' | 'quality') || 'speed',
          withAudio: false,
          size: session.size || '1280x720',
          fps: session.fps || 30,
          duration: 5,
        })
        taskId = result.taskId
        break
      } catch (err) {
        if (err instanceof ZaiRateLimitError) {
          console.log(`[chunked] chunk ${i + 1} rate limited, waiting 30s...`)
          await sleep(30000)
        } else {
          throw err
        }
      }
    }

    if (!taskId) {
      throw new Error(`Chunk ${i + 1}: failed to create task`)
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
        throw new Error(`Chunk ${i + 1}: ${status.errorMessage || 'FAIL'}`)
      }
    }

    if (videoUrl) {
      session.videoUrls.push(videoUrl)
      console.log(`[chunked] chunk ${i + 1}/${session.totalChunks} done`)
    }
  }

  // Stitch all chunks
  if (session.videoUrls.length > 0) {
    session.status = 'stitching'
    const uploadsDir = path.join(process.cwd(), 'public', 'uploads')
    await fs.promises.mkdir(uploadsDir, { recursive: true })
    const outputPath = path.join(uploadsDir, `chunked-${Date.now()}.mp4`)

    if (session.videoUrls.length === 1) {
      // Single chunk — just download
      const res = await fetch(session.videoUrls[0])
      const buf = Buffer.from(await res.arrayBuffer())
      await fs.promises.writeFile(outputPath, buf)
    } else {
      await stitchVideos(session.videoUrls, outputPath)
    }

    session.finalVideoUrl = `/uploads/${path.basename(outputPath)}`
    session.status = 'done'
    console.log(`[chunked] session ${sessionId} complete: ${session.finalVideoUrl}`)
  } else {
    session.status = 'error'
    session.error = 'No chunks were generated'
  }

  // Clean up session after 10 minutes
  setTimeout(() => sessions.delete(sessionId), 10 * 60 * 1000)
}
