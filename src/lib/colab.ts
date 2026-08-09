import fs from 'fs'
import path from 'path'

/**
 * Google Colab integration for REAL AI video generation.
 *
 * How it works:
 * 1. User runs a Colab notebook (public/colab-notebook.py) that loads
 *    Stable Video Diffusion model and starts a Flask server with ngrok tunnel.
 * 2. User pastes the ngrok URL into our app.
 * 3. Our app sends the image to Colab, which generates real AI video (SVD)
 *    using free T4 GPU.
 * 4. Video is returned as base64 MP4.
 *
 * This is 100% FREE (Google Colab free tier: T4 GPU, ~12 hours/day)
 * and produces REAL video diffusion (not just frame stitching).
 */

const COLAB_URL_FILE = path.join(process.cwd(), '.colab-url.json')

interface ColabConfig {
  url: string
}

function loadColabUrl(): string {
  try {
    const raw = fs.readFileSync(COLAB_URL_FILE, 'utf-8')
    const parsed = JSON.parse(raw) as ColabConfig
    return parsed.url || ''
  } catch {
    return ''
  }
}

export function saveColabUrl(url: string): void {
  fs.writeFileSync(
    COLAB_URL_FILE,
    JSON.stringify({ url: url.trim() }, null, 2),
    'utf-8',
  )
}

export function getColabUrl(): string {
  return loadColabUrl()
}

export interface ColabStatus {
  connected: boolean
  url: string
  model?: string
  gpu?: string
  error?: string
}

/** Check if the Colab server is alive and ready. */
export async function checkColabStatus(): Promise<ColabStatus> {
  const url = loadColabUrl()
  if (!url) {
    return { connected: false, url: '' }
  }
  try {
    const res = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) {
      return { connected: false, url, error: `HTTP ${res.status}` }
    }
    const data = await res.json()
    return {
      connected: data.status === 'ok' && data.ready === true,
      url,
      model: data.model,
      gpu: data.gpu,
    }
  } catch (err) {
    return {
      connected: false,
      url,
      error: err instanceof Error ? err.message : 'Connection failed',
    }
  }
}

export interface ColabGenerateResult {
  videoUrl: string
  provider: string
  elapsedMs: number
}

/**
 * Generate video via Colab (Stable Video Diffusion).
 * Sends base64 image, receives base64 MP4.
 */
export async function generateWithColab(
  imageBase64: string,
  opts: {
    motionBucketId?: number
    fps?: number
    numFrames?: number
  } = {},
): Promise<ColabGenerateResult> {
  const start = Date.now()
  const url = loadColabUrl()
  if (!url) {
    throw new Error('Colab URL не настроен. Откройте настройки провайдеров.')
  }

  const body = {
    image: imageBase64,
    motion_bucket_id: opts.motionBucketId ?? 127,
    fps: opts.fps ?? 6,
    num_frames: opts.numFrames ?? 25,
  }

  const res = await fetch(`${url}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300000), // 5 min timeout (SVD takes ~30-60s)
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(
      `Colab вернул ошибку ${res.status}: ${errText.slice(0, 200)}`,
    )
  }

  const data = await res.json()
  if (data.status !== 'ok' || !data.video) {
    throw new Error(data.error || 'Colab не вернул видео')
  }

  // Save the base64 video to a file
  const uploadsDir = path.join(process.cwd(), 'public', 'uploads')
  await fs.promises.mkdir(uploadsDir, { recursive: true })
  const timestamp = Date.now()
  const outputPath = path.join(uploadsDir, `colab-video-${timestamp}.mp4`)
  const videoBuf = Buffer.from(data.video, 'base64')
  await fs.promises.writeFile(outputPath, videoBuf)

  return {
    videoUrl: `/uploads/colab-video-${timestamp}.mp4`,
    provider: 'colab-svd',
    elapsedMs: Date.now() - start,
  }
}
