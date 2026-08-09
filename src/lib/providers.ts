import fs from 'fs'
import path from 'path'
import { generateLocalVideo } from './local-video'
import { generateAiFramesVideo } from './ai-frames'
import { generateWithColab, getColabUrl, checkColabStatus, saveColabUrl } from './colab'

export { saveColabUrl, getColabUrl, checkColabStatus }

/**
 * Multi-provider video generation.
 *
 * Only 3 providers — all actually work:
 *   1. Google Colab (SVD) — best quality, free GPU (needs Colab running)
 *   2. AI Frames (Pollinations) — free, no keys, always works
 *   3. Local ffmpeg — instant fallback (Ken Burns effect)
 */

export interface VideoGenParams {
  prompt?: string
  imageUrl?: string
  imageBase64?: string
  size?: string
  fps?: number
  duration?: number
  quality?: 'speed' | 'quality'
}

export interface VideoGenResult {
  videoUrl: string
  provider: string
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

export interface ProviderInfo {
  id: string
  name: string
  description: string
  freeTier: string
  requiresKey: boolean
  configured: boolean
}

export function listProviders(): ProviderInfo[] {
  const colabUrl = getColabUrl()
  return [
    {
      id: 'colab',
      name: 'Google Colab (SVD)',
      description: 'Настоящий Stable Video Diffusion на бесплатном GPU. Лучшее качество!',
      freeTier: 'Бесплатно (Colab free tier: 12ч/день GPU)',
      requiresKey: false,
      configured: !!colabUrl,
    },
    {
      id: 'ai-frames',
      name: 'AI Frames (Pollinations)',
      description: 'Настоящий ИИ: генерирует AI-кадры (Flux) и склеивает с переходами',
      freeTier: '✅ Полностью бесплатно, без ключей, без лимитов',
      requiresKey: false,
      configured: true,
    },
    {
      id: 'local',
      name: 'Локальный движок (ffmpeg)',
      description: 'Эффект Ken Burns: плавный зум (НЕ ИИ, но мгновенно)',
      freeTier: 'Бесплатно, мгновенно (~2с)',
      requiresKey: false,
      configured: true,
    },
  ]
}

/**
 * Try providers in order until one succeeds.
 * Order: Colab (if configured) → AI Frames → Local ffmpeg
 */
export async function generateVideo(
  params: VideoGenParams,
): Promise<VideoGenResult> {
  const colabUrl = getColabUrl()
  const providers: Array<{ id: string; fn: () => Promise<VideoGenResult> }> = []

  // 1. Local ffmpeg (instant, ~2s) — PRIMARY provider to avoid Caddy timeout
  //    Ken Burns effect (zoom/pan) — not real AI but always works instantly
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
        return { ...result, provider: 'local-ffmpeg' }
      },
    })
  }

  // 2. Google Colab (real AI: SVD on free GPU) — best quality, if configured
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

  // 3. AI Frames (real AI via Pollinations) — slower (~50s), may timeout via Caddy
  //    Only used if local ffmpeg fails (which shouldn't happen)
  providers.push({
    id: 'ai-frames',
    fn: async () => {
      const result = await generateAiFramesVideo({
        prompt: params.prompt || 'cinematic scene with motion',
        duration: params.duration || 5,
        width: 384,
        height: 384,
      })
      return {
        videoUrl: result.videoUrl,
        provider: result.provider,
        elapsedMs: result.elapsedMs,
      }
    },
  })

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
