import fs from 'fs'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)
const FFMPEG_PATH = '/usr/bin/ffmpeg'

/**
 * Stitch multiple video URLs into one long video using ffmpeg.
 * Downloads each segment, concatenates them with crossfade transitions.
 */

export async function stitchVideos(
  videoUrls: string[],
  outputPath: string,
): Promise<void> {
  if (videoUrls.length === 0) throw new Error('No videos to stitch')
  if (videoUrls.length === 1) {
    // Just download the single video
    const res = await fetch(videoUrls[0])
    const buf = Buffer.from(await res.arrayBuffer())
    await fs.promises.writeFile(outputPath, buf)
    return
  }

  const uploadsDir = path.dirname(outputPath)
  await fs.promises.mkdir(uploadsDir, { recursive: true })

  // Download all segments
  const segmentPaths: string[] = []
  for (let i = 0; i < videoUrls.length; i++) {
    const segPath = path.join(uploadsDir, `seg-${Date.now()}-${i}.mp4`)
    try {
      const res = await fetch(videoUrls[i], { signal: AbortSignal.timeout(30000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      await fs.promises.writeFile(segPath, buf)
      segmentPaths.push(segPath)
    } catch (err) {
      console.warn(`[stitch] failed to download segment ${i}:`, err)
    }
  }

  if (segmentPaths.length === 0) throw new Error('Failed to download any segments')
  if (segmentPaths.length === 1) {
    await fs.promises.copyFile(segmentPaths[0], outputPath)
    await fs.promises.unlink(segmentPaths[0])
    return
  }

  // Get duration of first segment for crossfade offset calculation
  const escapeShell = (s: string) => `'${s.replace(/'/g, "'\\''")}'`

  // Use ffmpeg concat demuxer (simpler, more reliable than xfade for multiple)
  const listPath = path.join(uploadsDir, `concat-list-${Date.now()}.txt`)
  const listContent = segmentPaths.map((p) => `file '${p}'`).join('\n')
  await fs.promises.writeFile(listPath, listContent)

  const cmd = `${FFMPEG_PATH} -y -f concat -safe 0 -i ${escapeShell(listPath)} -c copy ${escapeShell(outputPath)}`
  console.log('[stitch] running:', cmd.slice(0, 150))

  try {
    await execAsync(cmd, { timeout: 30000, maxBuffer: 2 * 1024 * 1024 })
  } catch (err) {
    // If concat copy fails (different codecs), re-encode
    console.warn('[stitch] concat copy failed, re-encoding...')
    const cmd2 = `${FFMPEG_PATH} -y -f concat -safe 0 -i ${escapeShell(listPath)} -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p ${escapeShell(outputPath)}`
    await execAsync(cmd2, { timeout: 60000, maxBuffer: 2 * 1024 * 1024 })
  }

  // Cleanup segments
  for (const p of segmentPaths) {
    await fs.promises.unlink(p).catch(() => {})
  }
  await fs.promises.unlink(listPath).catch(() => {})
}
