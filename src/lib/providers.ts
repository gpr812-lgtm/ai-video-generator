import fs from 'fs'
import path from 'path'
import os from 'os'
import { generateLocalVideo } from './local-video'
import { generateAiFramesVideo } from './ai-frames'
import { generateWithColab, getColabUrl, checkColabStatus, saveColabUrl } from './colab'

export { saveColabUrl, getColabUrl, checkColabStatus }

/**
 * Multi-provider video generation.
 *
 * ZAI has a strict rate limit (1 req / 10 min / key). To get more throughput
 * without paying, we integrate multiple free providers and auto-fallback:
 *
 *   1. Local ffmpeg (Ken Burns effect) — PRIMARY: free, instant, no limits
 *   2. HuggingFace Spaces (genuinely free, via Gradio API) — AI fallback
 *   3. Segmind (100 free calls on signup) — fallback
 *   4. Replicate (free credits on signup) — fallback
 *   5. ZAI (1 req / 10 min / key) — last resort
 *
 * Each provider has its own endpoint, auth, and request/response format.
 * The app tries providers in order until one succeeds.
 */

export interface VideoGenParams {
  prompt?: string
  /** Public HTTP URL of the input image (preferred over base64). */
  imageUrl?: string
  /** Raw base64 of the input image (no data: prefix). */
  imageBase64?: string
  size?: string
  fps?: number
  duration?: number
  quality?: 'speed' | 'quality'
}

export interface VideoGenResult {
  /** Direct URL to the generated MP4. */
  videoUrl: string
  /** Which provider produced this video. */
  provider: string
  /** How long the generation took (ms). */
  elapsedMs: number
}

export class ProviderError extends Error {
  provider: string
  retryable: boolean
  constructor(provider: string, message: string, retryable = true) {
    super(message)
    this.name = 'ProviderError'
    this.provider = provider
    this.retryable = retryable
  }
}

// ============================================================================
// Provider key management (stored in /home/z/my-project/.provider-keys.json)
// ============================================================================

interface ProviderKeys {
  replicate?: string
  segmind?: string
  huggingface?: string
}

const KEYS_FILE = path.join(process.cwd(), '.provider-keys.json')

function loadProviderKeys(): ProviderKeys {
  try {
    const raw = fs.readFileSync(KEYS_FILE, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function saveProviderKeys(keys: ProviderKeys): void {
  fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2), 'utf-8')
}

export function getProviderKeys(): ProviderKeys {
  return loadProviderKeys()
}

export function setProviderKey(provider: keyof ProviderKeys, key: string): void {
  const keys = loadProviderKeys()
  if (key.trim()) {
    keys[provider] = key.trim()
  } else {
    delete keys[provider]
  }
  saveProviderKeys(keys)
}

// ============================================================================
// Helper: upload base64 image to a temp host so providers that need a URL work.
// We use catbox.moe (free, anonymous, no key needed) as a public image host.
// ============================================================================

async function uploadImageToHost(base64: string): Promise<string> {
  // catbox.moe litterbox endpoint — anonymous, returns a public URL
  const form = new FormData()
  form.append('reqtype', 'fileupload')
  form.append('time', '24h')
  const blob = Uint8Array.from(Buffer.from(base64, 'base64'))
  form.append('fileToUpload', new Blob([blob], { type: 'image/jpeg' }), 'image.jpg')

  const res = await fetch('https://litterbox.catbox.moe/resources/internals/api.php', {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) {
    throw new ProviderError('upload', `Upload failed: HTTP ${res.status}`, false)
  }
  const text = await res.text()
  if (!text.startsWith('http')) {
    throw new ProviderError('upload', `Upload returned unexpected: ${text.slice(0, 100)}`, false)
  }
  return text.trim()
}

/** Ensures we have a public image URL. If only base64 is provided, uploads it. */
async function ensureImageUrl(params: VideoGenParams): Promise<VideoGenParams & { imageUrl: string }> {
  if (params.imageUrl) {
    return { ...params, imageUrl: params.imageUrl }
  }
  if (!params.imageBase64) {
    throw new ProviderError('input', 'Neither imageUrl nor imageBase64 provided', false)
  }
  const url = await uploadImageToHost(params.imageBase64)
  return { ...params, imageUrl: url }
}

// ============================================================================
// Provider 1: HuggingFace Spaces (Gradio API) — GENUINELY FREE
// ============================================================================

const HF_SVD_SPACE = 'https://mediasynthesismuseum-stable-video-diffusion.hf.space'

async function generateWithHuggingFace(
  params: VideoGenParams,
): Promise<VideoGenResult> {
  const start = Date.now()
  const keys = loadProviderKeys()
  const { imageUrl } = await ensureImageUrl(params)

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (keys.huggingface) {
    headers['Authorization'] = `Bearer ${keys.huggingface}`
  }

  // Try multiple parameter orders — HF Spaces vary in their input signatures
  const paramVariants = [
    [imageUrl, 6, 127, 0.02, 2, 25],      // [image, fps, motion_bucket, noise, decode_mode, frames]
    [imageUrl, 127, 6, 0.02],              // [image, motion_bucket, fps, noise]
    [imageUrl, 6, 127],                     // [image, fps, motion_bucket]
    [imageUrl],                             // [image] only
  ]

  let eventId: string | null = null
  let lastError = ''
  for (const variant of paramVariants) {
    try {
      const createRes = await fetch(`${HF_SVD_SPACE}/gradio_api/call/video`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ data: variant }),
        signal: AbortSignal.timeout(15000),
      })
      if (createRes.ok) {
        const createData = await createRes.json()
        if (createData.event_id) {
          eventId = createData.event_id
          break
        }
      }
      lastError = `HTTP ${createRes.status}`
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
    }
  }

  if (!eventId) {
    throw new ProviderError(
      'huggingface',
      `HF Space не принял запрос (${lastError}). Попробуйте позже или используйте Segmind/Replicate.`,
    )
  }

  // Poll for result via SSE
  let videoUrl: string | null = null
  let errorMsg: string | null = null
  const maxWaitMs = 240000 // 4 minutes
  const startWait = Date.now()

  while (Date.now() - startWait < maxWaitMs) {
    const sseRes = await fetch(
      `${HF_SVD_SPACE}/gradio_api/call/video/${eventId}`,
      { headers, signal: AbortSignal.timeout(60000) },
    )
    if (!sseRes.ok) {
      throw new ProviderError('huggingface', `SSE poll returned ${sseRes.status}`)
    }
    const sseText = await sseRes.text()
    const lines = sseText.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('event: complete')) {
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].startsWith('data:')) {
            const jsonStr = lines[j].slice(5).trim()
            try {
              const data = JSON.parse(jsonStr)
              const item = Array.isArray(data) ? data[0] : data
              videoUrl =
                item?.url ||
                item?.video?.url ||
                item?.path ||
                (typeof item === 'string' ? item : null)
              if (videoUrl && !videoUrl.startsWith('http')) {
                videoUrl = `${HF_SVD_SPACE}/file=${videoUrl}`
              }
            } catch {
              /* ignore parse errors */
            }
          }
        }
      }
      if (lines[i].startsWith('event: error')) {
        const dataLine = lines[i + 1] || ''
        errorMsg = dataLine.replace('data:', '').trim().slice(0, 200)
      }
    }
    if (videoUrl) break
    if (errorMsg) {
      throw new ProviderError(
        'huggingface',
        `HF Space error: ${errorMsg || 'unknown'}. Space может быть перегружен — попробуйте позже.`,
      )
    }
    await new Promise((r) => setTimeout(r, 3000))
  }

  if (!videoUrl) {
    throw new ProviderError('huggingface', 'HF Space timed out after 4 minutes')
  }

  return {
    videoUrl,
    provider: 'huggingface',
    elapsedMs: Date.now() - start,
  }
}

// ============================================================================
// Provider 2: Segmind — 100 free calls on signup
// ============================================================================

async function generateWithSegmind(
  params: VideoGenParams,
): Promise<VideoGenResult> {
  const start = Date.now()
  const keys = loadProviderKeys()
  if (!keys.segmind) {
    throw new ProviderError('segmind', 'Segmind API key not configured', false)
  }

  const { imageUrl } = await ensureImageUrl(params)

  const res = await fetch('https://api.segmind.com/v1/stable-video-diffusion-img2vid', {
    method: 'POST',
    headers: {
      'x-api-key': keys.segmind,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      image: imageUrl,
      frames: 14,
      fps: 6,
      motion_bucket_id: 127,
      noise_aug_strength: 0.02,
    }),
    signal: AbortSignal.timeout(180000), // 3 min — SVD is slow
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new ProviderError(
      'segmind',
      `Segmind returned ${res.status}: ${body.slice(0, 150)}`,
    )
  }

  // Segmind returns JSON with video_url or output
  const contentType = res.headers.get('content-type') || ''
  let videoUrl: string | null = null

  if (contentType.includes('application/json')) {
    const data = await res.json()
    videoUrl = data.video_url || data.output || data.video || data.url
  } else {
    // Might return the MP4 binary directly
    const buf = Buffer.from(await res.arrayBuffer())
    // Save to public/uploads and return URL
    const fs2 = await import('fs')
    const filename = `segmind-${Date.now()}.mp4`
    const filepath = path.join(process.cwd(), 'public', 'uploads', filename)
    await fs2.promises.mkdir(path.dirname(filepath), { recursive: true })
    await fs2.promises.writeFile(filepath, buf)
    videoUrl = `/uploads/${filename}`
  }

  if (!videoUrl) {
    throw new ProviderError('segmind', 'Segmind did not return a video URL')
  }

  return {
    videoUrl,
    provider: 'segmind',
    elapsedMs: Date.now() - start,
  }
}

// ============================================================================
// Provider 3: Replicate — free credits on signup
// ============================================================================

async function generateWithReplicate(
  params: VideoGenParams,
): Promise<VideoGenResult> {
  const start = Date.now()
  const keys = loadProviderKeys()
  if (!keys.replicate) {
    throw new ProviderError('replicate', 'Replicate API key not configured', false)
  }

  const { imageUrl } = await ensureImageUrl(params)

  // Create prediction
  const createRes = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${keys.replicate}`,
      'Content-Type': 'application/json',
      Prefer: 'wait=120', // long-poll up to 120s
    },
    body: JSON.stringify({
      model: 'stability-ai/stable-video-diffusion',
      input: {
        cond_image: imageUrl,
        motion_bucket_id: 127,
        fps: 7,
      },
    }),
    signal: AbortSignal.timeout(150000),
  })

  if (!createRes.ok) {
    const body = await createRes.text().catch(() => '')
    throw new ProviderError(
      'replicate',
      `Replicate returned ${createRes.status}: ${body.slice(0, 150)}`,
    )
  }

  let prediction = await createRes.json()

  // Poll if not done yet (Prefer: wait may have timed out)
  let pollCount = 0
  while (
    !['succeeded', 'failed', 'canceled'].includes(prediction.status) &&
    pollCount < 60
  ) {
    pollCount++
    await new Promise((r) => setTimeout(r, 3000))
    const pollRes = await fetch(prediction.urls.get, {
      headers: { Authorization: `Bearer ${keys.replicate}` },
      signal: AbortSignal.timeout(15000),
    })
    if (!pollRes.ok) {
      throw new ProviderError('replicate', `Poll returned ${pollRes.status}`)
    }
    prediction = await pollRes.json()
  }

  if (prediction.status !== 'succeeded') {
    throw new ProviderError(
      'replicate',
      `Replicate prediction ${prediction.status}: ${prediction.error || 'unknown'}`,
    )
  }

  const videoUrl = prediction.output
  if (!videoUrl || (typeof videoUrl !== 'string' && !Array.isArray(videoUrl))) {
    throw new ProviderError('replicate', 'Replicate did not return a video URL')
  }

  return {
    videoUrl: Array.isArray(videoUrl) ? videoUrl[0] : videoUrl,
    provider: 'replicate',
    elapsedMs: Date.now() - start,
  }
}

// ============================================================================
// Provider registry + auto-fallback
// ============================================================================

export interface ProviderInfo {
  id: string
  name: string
  description: string
  freeTier: string
  requiresKey: boolean
  keyLabel?: string
  signupUrl?: string
  configured: boolean
}

export function listProviders(): ProviderInfo[] {
  const keys = loadProviderKeys()
  const colabUrl = getColabUrl()
  return [
    {
      id: 'colab',
      name: 'Google Colab (SVD)',
      description: 'Настоящий Stable Video Diffusion на бесплатном GPU (T4). Лучшее качество!',
      freeTier: '✅ Бесплатно (Colab free tier: 12ч/день GPU). Нужен запуск notebook',
      requiresKey: false,
      configured: !!colabUrl,
    },
    {
      id: 'ai-frames',
      name: 'AI Frames (Pollinations)',
      description: 'Настоящий ИИ: генерирует несколько AI-кадров (Flux/SD) и склеивает с плавными переходами',
      freeTier: '✅ Полностью бесплатно, без ключей, без лимитов',
      requiresKey: false,
      configured: true,
    },
    {
      id: 'local',
      name: 'Локальный движок (ffmpeg)',
      description: 'Эффект Ken Burns: плавный зум + панорамирование (НЕ ИИ)',
      freeTier: 'Бесплатно, мгновенно (~2с), но не настоящий ИИ',
      requiresKey: false,
      configured: true,
    },
    {
      id: 'huggingface',
      name: 'HuggingFace Spaces',
      description: 'Stable Video Diffusion (AI) через публичный Space',
      freeTier: 'Бесплатно, но часто перегружен (ZeroGPU)',
      requiresKey: false,
      keyLabel: 'HF Token (необязательно, повышает лимиты)',
      signupUrl: 'https://huggingface.co/settings/tokens',
      configured: true, // works without key
    },
    {
      id: 'segmind',
      name: 'Segmind',
      description: 'Stable Video Diffusion, синхронный API',
      freeTier: '100 бесплатных вызовов при регистрации',
      requiresKey: true,
      keyLabel: 'Segmind API Key',
      signupUrl: 'https://cloud.segmind.com/console/api-keys',
      configured: !!keys.segmind,
    },
    {
      id: 'replicate',
      name: 'Replicate',
      description: 'Stable Video Diffusion и другие AI модели',
      freeTier: 'Бесплатные кредиты при регистрации (~$1)',
      requiresKey: true,
      keyLabel: 'Replicate API Token',
      signupUrl: 'https://replicate.com/account/api-tokens',
      configured: !!keys.replicate,
    },
  ]
}

/**
 * Try providers in order until one succeeds.
 * Order: Local ffmpeg (instant, free) → HuggingFace → Segmind → Replicate
 *
 * The local engine ALWAYS works (no API, no rate limits) so generation
 * effectively never fails. AI providers are tried first for higher quality,
 * but local is the reliable fallback.
 */
export async function generateVideo(
  params: VideoGenParams,
): Promise<VideoGenResult> {
  const keys = loadProviderKeys()
  const colabUrl = getColabUrl()
  const providers: Array<{ id: string; fn: () => Promise<VideoGenResult> }> = []

  // Try REAL AI providers first, best quality first:
  // Colab (SVD) → Replicate → Segmind → HuggingFace → AI-Frames → local ffmpeg

  // 0. Google Colab (real AI: Stable Video Diffusion on free T4 GPU) — BEST quality
  if (colabUrl && params.imageBase64) {
    providers.push({
      id: 'colab-svd',
      fn: async () => {
        const result = await generateWithColab(params.imageBase64!, {
          motionBucketId: 127,
          fps: 6,
          numFrames: 25,
        })
        return {
          videoUrl: result.videoUrl,
          provider: result.provider,
          elapsedMs: result.elapsedMs,
        }
      },
    })
  }

  // 1. Replicate (real AI: Stable Video Diffusion) — if configured
  if (keys.replicate) {
    providers.push({ id: 'replicate', fn: () => generateWithReplicate(params) })
  }

  // 2. Segmind (real AI: SVD) — if configured
  if (keys.segmind) {
    providers.push({ id: 'segmind', fn: () => generateWithSegmind(params) })
  }

  // 3. HuggingFace (real AI, free but unreliable ZeroGPU)
  providers.push({ id: 'huggingface', fn: () => generateWithHuggingFace(params) })

  // 4. AI Frames (real AI via Pollinations — FREE, no key needed!)
  //    Generates multiple AI frames with seed variation, stitches with crossfade.
  //    Each frame is AI-generated (Stable Diffusion / Flux).
  providers.push({
    id: 'ai-frames',
    fn: async () => {
      // Decode the user's image to use as context for the prompt
      let imageBuffer: Buffer | undefined
      if (params.imageBase64) {
        imageBuffer = Buffer.from(params.imageBase64, 'base64')
      }
      const result = await generateAiFramesVideo({
        prompt: params.prompt || 'cinematic scene with motion',
        duration: params.duration || 5,
        width: 512,
        height: 512,
        baseImageBuffer: imageBuffer,
      })
      return {
        videoUrl: result.videoUrl,
        provider: result.provider,
        elapsedMs: result.elapsedMs,
      }
    },
  })

  // 5. Local ffmpeg (NOT real AI — just zoom/pan). Last resort fallback
  //    so the user always gets SOME video, even if all AI providers fail.
  if (params.imageBase64) {
    providers.push({
      id: 'local-ffmpeg',
      fn: async () => {
        const buf = Buffer.from(params.imageBase64!, 'base64')
        const prompt = (params.prompt || '').toLowerCase()
        let motion: 'zoom-in' | 'zoom-out' | 'pan-right' | 'pan-left' | 'zoom-pan' = 'zoom-pan'
        if (prompt.includes('zoom') && prompt.includes('out')) motion = 'zoom-out'
        else if (prompt.includes('zoom')) motion = 'zoom-in'
        else if (prompt.includes('pan') && (prompt.includes('right') || prompt.includes('вправ'))) motion = 'pan-right'
        else if (prompt.includes('pan') && (prompt.includes('left') || prompt.includes('влев'))) motion = 'pan-left'
        const result = await generateLocalVideo(buf, {
          duration: params.duration || 5,
          fps: 25,
          motion,
        })
        return { ...result, provider: 'local-ffmpeg (не ИИ)' }
      },
    })
  }

  const errors: Array<{ provider: string; error: string }> = []
  for (const { id, fn } of providers) {
    try {
      console.log(`[video] trying provider: ${id}`)
      const result = await fn()
      console.log(`[video] provider ${id} succeeded in ${result.elapsedMs}ms`)
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[video] provider ${id} failed: ${msg}`)
      errors.push({ provider: id, error: msg })
    }
  }

  throw new ProviderError(
    'all',
    `Все провайдеры не сработали: ${errors.map((e) => `${e.provider}(${e.error.slice(0, 80)})`).join('; ')}`,
    false,
  )
}
