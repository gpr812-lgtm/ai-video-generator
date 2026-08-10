import fs from 'fs'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

const FFMPEG_PATH = '/usr/bin/ffmpeg'

function resolveFfmpeg(): string {
  const candidates = ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg']
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c } catch {}
  }
  return 'ffmpeg'
}

const FFMPEG_BINARY = resolveFfmpeg()

export interface LocalVideoResult {
  videoUrl: string
  provider: string
  elapsedMs: number
}

export async function generateLocalVideo(
  imageBuffer: Buffer,
  opts: {
    duration?: number
    fps?: number
    motion?: 'zoom-in' | 'zoom-out' | 'pan-right' | 'pan-left' | 'zoom-pan'
  } = {},
): Promise<LocalVideoResult> {
  const start = Date.now()
  const duration = opts.duration || 5
  const fps = opts.fps || 25
  const motion = opts.motion || 'zoom-pan'

  const uploadsDir = path.join(process.cwd(), 'public', 'uploads')
  await fs.promises.mkdir(uploadsDir, { recursive: true })

  const timestamp = Date.now()
  const inputPath = path.join(uploadsDir, `input-${timestamp}.jpg`)
  const outputPath = path.join(uploadsDir, `video-${timestamp}.mp4`)
  await fs.promises.writeFile(inputPath, imageBuffer)

  const totalFrames = duration * fps
  let filter: string

  switch (motion) {
    case 'zoom-in':
      filter = `scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,zoompan=z='min(zoom+0.0015,1.2)':d=${totalFrames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1280x720:fps=${fps}`
      break
    case 'zoom-out':
      filter = `scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,zoompan=z='if(eq(on,0),1.2,max(1.0,zoom-0.0015))':d=${totalFrames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1280x720:fps=${fps}`
      break
    case 'pan-right':
      filter = `scale=1920:720:force_original_aspect_ratio=increase,crop=1920:720,zoompan=z='1.1':d=${totalFrames}:x='(iw-iw/zoom)*on/${totalFrames}':y='ih/2-(ih/zoom/2)':s=1280x720:fps=${fps}`
      break
    case 'pan-left':
      filter = `scale=1920:720:force_original_aspect_ratio=increase,crop=1920:720,zoompan=z='1.1':d=${totalFrames}:x='(iw-iw/zoom)*(1-on/${totalFrames})':y='ih/2-(ih/zoom/2)':s=1280x720:fps=${fps}`
      break
    case 'zoom-pan':
    default:
      filter = `scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,zoompan=z='min(zoom+0.0012,1.18)':d=${totalFrames}:x='(iw-iw/zoom)*0.3*sin(on/${totalFrames}*3.14159)':y='ih/2-(ih/zoom/2)':s=1280x720:fps=${fps}`
      break
  }

  const escapeShell = (s: string) => `'${s.replace(/'/g, "'\\''")}'`
  const cmd = `${FFMPEG_BINARY} -y -loop 1 -i ${escapeShell(inputPath)} -vf ${escapeShell(filter)} -t ${duration} -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p -movflags +faststart ${escapeShell(outputPath)}`

  try {
    await execAsync(cmd, { timeout: 30000, maxBuffer: 2 * 1024 * 1024 })
  } catch (err) {
    await fs.promises.unlink(inputPath).catch(() => {})
    throw new Error(`ffmpeg failed: ${err instanceof Error ? err.message : 'unknown error'}`)
  }

  await fs.promises.unlink(inputPath).catch(() => {})
  try { await fs.promises.access(outputPath) } catch { throw new Error('ffmpeg did not produce output') }

  return { videoUrl: `/uploads/video-${timestamp}.mp4`, provider: 'local-ffmpeg', elapsedMs: Date.now() - start }
}
