import { NextRequest, NextResponse } from 'next/server'
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
 * Standalone AI Video Generator — NO ZAI, NO API keys, NO limits.
 * Uses Pollinations.ai (free, open-source, Flux model) to generate
 * 10 AI frames, then stitches them into a video with ffmpeg.
 *
 * This is 100% free and works without any configuration.
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
    if (!prompt) return NextResponse.json({ error: 'Промпт обязателен' }, { status: 400 })

    const sessionId = `aiv-${Date.now()}`
    const totalDuration = duration || 5
    const numFrames = Math.min(10, Math.max(5, Math.ceil(totalDuration * 2)))

    const session: Session = {
      id: sessionId, status: 'generating', framesDone: 0, framesTotal: numFrames,
      prompt, duration: totalDuration,
    }
    sessions.set(sessionId, session)

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
  const uploadsDir = path.join(process.cwd(), 'public', 'uploads')
  await fs.promises.mkdir(uploadsDir, { recursive: true })
  const framesDir = path.join(uploadsDir, sessionId)
  await fs.promises.mkdir(framesDir, { recursive: true })

  const motionWords = [
    'wide establishing shot, beginning',
    'camera slowly moves forward',
    'continuing motion, slight zoom in',
    'mid-point, dynamic angle change',
    'closer view, detail emerging',
    'camera pulls back slightly',
    'new perspective, side angle view',
    'dramatic lighting, approaching climax',
    'close-up detail, dramatic moment',
    'wide shot, conclusion, final frame',
  ]

  const framePaths: string[] = []
  for (let i = 0; i < session.framesTotal; i++) {
    const motionHint = motionWords[i % motionWords.length]
    const framePrompt = `${session.prompt}, ${motionHint}, cinematic, high quality, detailed`
    const encodedPrompt = encodeURIComponent(framePrompt.slice(0, 200))
    const seed = 1000 + i * 137
    const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=576&seed=${seed}&nologo=true&model=flux`

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length < 1000) throw new Error('Response too small')

      const framePath = path.join(framesDir, `frame_${String(i).padStart(3, '0')}.jpg`)
      await fs.promises.writeFile(framePath, buf)
      framePaths.push(framePath)
      session.framesDone = i + 1
      console.log(`[ai-video] ${sessionId} frame ${i + 1}/${session.framesTotal} done`)
    } catch (err) {
      console.warn(`[ai-video] frame ${i + 1} failed:`, err instanceof Error ? err.message : err)
      // Retry once
      try {
        await sleep(3000)
        const res = await fetch(url, { signal: AbortSignal.timeout(30000) })
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer())
          if (buf.length > 1000) {
            const framePath = path.join(framesDir, `frame_${String(i).padStart(3, '0')}.jpg`)
            await fs.promises.writeFile(framePath, buf)
            framePaths.push(framePath)
            session.framesDone = i + 1
          }
        }
      } catch {
        // Skip this frame
      }
    }
    if (i < session.framesTotal - 1) await sleep(500)
  }

  if (framePaths.length < 2) {
    session.status = 'error'
    session.error = 'Недостаточно кадров. Попробуйте ещё раз.'
    return
  }

  // Stitch with ffmpeg
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
