import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'fs'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)
const FFMPEG_PATH = '/usr/bin/ffmpeg'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export const runtime = 'nodejs'
export const maxDuration = 25

/**
 * AI Video Generator using ZAI Image API (30 req/10min).
 * Async: POST creates session, GET polls status.
 * Generates 10 AI frames → stitches into video.
 */

interface Session {
  id: string
  status: 'generating' | 'stitching' | 'done' | 'error'
  framesDone: number
  framesTotal: number
  videoUrl?: string
  error?: string
  prompt: string
  duration: number
}

const sessions = new Map<string, Session>()

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { prompt, duration } = body as { prompt: string; duration?: number }

    if (!prompt) {
      return NextResponse.json({ error: 'Промпт обязателен' }, { status: 400 })
    }

    const sessionId = `aivideo-${Date.now()}`
    const totalDuration = duration || 5
    const numFrames = Math.min(10, Math.max(5, Math.ceil(totalDuration * 2)))

    const session: Session = {
      id: sessionId,
      status: 'generating',
      framesDone: 0,
      framesTotal: numFrames,
      prompt,
      duration: totalDuration,
    }
    sessions.set(sessionId, session)

    // Start background generation
    generateInBackground(sessionId).catch((err) => {
      session.status = 'error'
      session.error = err instanceof Error ? err.message : 'Unknown error'
    })

    return NextResponse.json({ sessionId, framesTotal: numFrames, status: 'generating' })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId')
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  const session = sessions.get(sessionId)
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  return NextResponse.json(session)
}

async function generateInBackground(sessionId: string) {
  const session = sessions.get(sessionId)!
  const zai = await ZAI.create()
  const uploadsDir = path.join(process.cwd(), 'public', 'uploads')
  await fs.promises.mkdir(uploadsDir, { recursive: true })
  const framesDir = path.join(uploadsDir, `${sessionId}`)
  await fs.promises.mkdir(framesDir, { recursive: true })

  const motionWords = [
    'wide establishing shot', 'camera moves forward', 'continuing motion zoom',
    'mid-point dynamic angle', 'closer view detail', 'camera pulls back',
    'new perspective side angle', 'dramatic lighting', 'close-up detail',
    'wide shot conclusion',
  ]

  const framePaths: string[] = []
  for (let i = 0; i < session.framesTotal; i++) {
    const framePrompt = `${session.prompt}, ${motionWords[i % motionWords.length]}, cinematic, high quality`
    try {
      const result = await zai.images.generations.create({ prompt: framePrompt, size: '1024x576' as any })
      const imgData = result.data[0] as any
      let imgBuffer: Buffer
      if (imgData.base64) {
        imgBuffer = Buffer.from(imgData.base64, 'base64')
      } else if (imgData.url) {
        const imgRes = await fetch(imgData.url)
        imgBuffer = Buffer.from(new Uint8Array(await imgRes.arrayBuffer()))
      } else {
        throw new Error('No image data')
      }
      const framePath = path.join(framesDir, `frame_${String(i).padStart(3, '0')}.jpg`)
      await fs.promises.writeFile(framePath, imgBuffer)
      framePaths.push(framePath)
      session.framesDone = i + 1
      console.log(`[ai-video] ${sessionId} frame ${i + 1}/${session.framesTotal}`)
      if (i < session.framesTotal - 1) await sleep(600)
    } catch (err) {
      console.warn(`[ai-video] frame ${i + 1} failed`)
      if (framePaths.length >= 3) break
      await sleep(2000)
    }
  }

  if (framePaths.length < 2) {
    session.status = 'error'
    session.error = 'Недостаточно кадров'
    return
  }

  // Stitch
  session.status = 'stitching'
  const outputPath = path.join(uploadsDir, `${sessionId}.mp4`)
  const escapeShell = (s: string) => `'${s.replace(/'/g, "'\\''")}'`
  const frameDuration = session.duration / framePaths.length

  const clipPaths: string[] = []
  for (let i = 0; i < framePaths.length; i++) {
    const clipPath = path.join(framesDir, `clip_${String(i).padStart(3, '0')}.mp4`)
    const zoomFilter = `zoompan=z='min(zoom+0.0005,1.08)':d=${Math.round(frameDuration * 25)}:s=1024x576:fps=25`
    try {
      await execAsync(`${FFMPEG_PATH} -y -loop 1 -i ${escapeShell(framePaths[i])} -vf ${escapeShell(zoomFilter)} -t ${frameDuration} -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p ${escapeShell(clipPath)}`, { timeout: 15000, maxBuffer: 1024 * 1024 })
      clipPaths.push(clipPath)
    } catch { /* skip */ }
  }

  if (clipPaths.length === 0) {
    session.status = 'error'
    session.error = 'ffmpeg failed'
    return
  }

  if (clipPaths.length === 1) {
    await fs.promises.copyFile(clipPaths[0], outputPath)
  } else {
    const listPath = path.join(framesDir, 'concat.txt')
    await fs.promises.writeFile(listPath, clipPaths.map((p) => `file '${p}'`).join('\n'))
    await execAsync(`${FFMPEG_PATH} -y -f concat -safe 0 -i ${escapeShell(listPath)} -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p -movflags +faststart ${escapeShell(outputPath)}`, { timeout: 60000, maxBuffer: 2 * 1024 * 1024 })
  }

  await fs.promises.rm(framesDir, { recursive: true, force: true }).catch(() => {})
  try { await fs.promises.access(outputPath) } catch {
    session.status = 'error'
    session.error = 'ffmpeg error'
    return
  }

  session.videoUrl = `/uploads/${sessionId}.mp4`
  session.status = 'done'
  console.log(`[ai-video] ${sessionId} complete: ${session.videoUrl}`)

  setTimeout(() => sessions.delete(sessionId), 10 * 60 * 1000)
}
