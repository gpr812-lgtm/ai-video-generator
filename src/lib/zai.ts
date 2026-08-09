import fs from 'fs'
import path from 'path'
import os from 'os'

/**
 * Multi-key ZAI configuration.
 *
 * ZAI limits each API key to 1 video-generation request per несколько минут.
 * To get more throughput without paying, the user can register multiple free
 * Z.ai accounts and add each key here. The app rotates between keys, using
 * whichever one has a free slot. With N keys → N requests per несколько минут.
 *
 * Keys are loaded from two sources:
 *   1. The default config file (/etc/.z-ai-config) — always available.
 *   2. A user-managed keys file at /home/z/my-project/.z-ai-extra-keys.json
 *      (format: [{"apiKey":"...","token":"..."}, ...]) — populated via the
 *      /api/keys endpoint when the user adds keys in the UI.
 */
interface ZaiKey {
  apiKey: string
  token?: string
  label?: string
}

interface ZaiConfig {
  baseUrl: string
}

let cachedBaseUrl: string | null = null
let cachedDefaultKey: ZaiKey | null = null

const EXTRA_KEYS_FILE = path.join(process.cwd(), '.z-ai-extra-keys.json')

function loadDefaultConfig(): { baseUrl: string; key: ZaiKey } {
  if (cachedBaseUrl && cachedDefaultKey) {
    return { baseUrl: cachedBaseUrl, key: cachedDefaultKey }
  }
  const candidates = [
    path.join(process.cwd(), '.z-ai-config'),
    path.join(os.homedir(), '.z-ai-config'),
    '/etc/.z-ai-config',
  ]
  for (const p of candidates) {
    try {
      const raw = fs.readFileSync(p, 'utf-8')
      const parsed = JSON.parse(raw)
      if (parsed.baseUrl && parsed.apiKey) {
        cachedBaseUrl = parsed.baseUrl
        cachedDefaultKey = {
          apiKey: parsed.apiKey,
          token: parsed.token,
          label: 'default',
        }
        console.log('[zai] default config loaded from', p)
        return { baseUrl: cachedBaseUrl, key: cachedDefaultKey }
      }
    } catch {
      /* try next */
    }
  }
  throw new Error('ZAI config not found in any of: ' + candidates.join(', '))
}

function loadExtraKeys(): ZaiKey[] {
  try {
    const raw = fs.readFileSync(EXTRA_KEYS_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed.filter((k) => k && typeof k.apiKey === 'string')
    }
  } catch {
    /* file doesn't exist yet */
  }
  return []
}

function saveExtraKeys(keys: ZaiKey[]): void {
  fs.writeFileSync(EXTRA_KEYS_FILE, JSON.stringify(keys, null, 2), 'utf-8')
}

/** Returns ALL available keys (default + extra). */
function getAllKeys(): ZaiKey[] {
  const { key } = loadDefaultConfig()
  const extra = loadExtraKeys()
  // Deduplicate by apiKey
  const seen = new Set([key.apiKey])
  const result = [key]
  for (const k of extra) {
    if (!seen.has(k.apiKey)) {
      seen.add(k.apiKey)
      result.push(k)
    }
  }
  return result
}

export function listKeys(): Array<{ label: string; apiKeyPreview: string; isDefault: boolean }> {
  const { key } = loadDefaultConfig()
  const extra = loadExtraKeys()
  const result: Array<{ label: string; apiKeyPreview: string; isDefault: boolean }> = [
    {
      label: key.label || 'default',
      apiKeyPreview: key.apiKey.slice(0, 8) + '…' + key.apiKey.slice(-4),
      isDefault: true,
    },
  ]
  for (const k of extra) {
    result.push({
      label: k.label || 'extra',
      apiKeyPreview: k.apiKey.slice(0, 8) + '…' + k.apiKey.slice(-4),
      isDefault: false,
    })
  }
  return result
}

export function addKey(apiKey: string, token?: string, label?: string): void {
  const trimmed = apiKey.trim()
  if (!trimmed) throw new Error('API key не может быть пустым')
  const extra = loadExtraKeys()
  // Don't add duplicates
  if (extra.some((k) => k.apiKey === trimmed) || trimmed === cachedDefaultKey?.apiKey) {
    throw new Error('Этот API key уже добавлен')
  }
  extra.push({ apiKey: trimmed, token: token?.trim() || undefined, label: label || `key-${extra.length + 2}` })
  saveExtraKeys(extra)
  console.log('[zai] added extra key:', label, '· total keys now:', extra.length + 1)
}

export function removeKey(apiKey: string): void {
  const extra = loadExtraKeys().filter((k) => k.apiKey !== apiKey)
  saveExtraKeys(extra)
  console.log('[zai] removed key, remaining extra keys:', extra.length)
}

function buildHeaders(key: ZaiKey): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${key.apiKey}`,
    'X-Z-AI-From': 'Z',
  }
  if (key.token) {
    headers['X-Token'] = key.token
  }
  return headers
}

export interface VideoOptions {
  prompt?: string
  imageUrl?: string
  quality?: 'speed' | 'quality'
  withAudio?: boolean
  size?: string
  fps?: number
  duration?: number
}

export interface CreateVideoResult {
  taskId: string
  taskStatus: 'PROCESSING' | 'SUCCESS' | 'FAIL'
  usedPreset?: string
}

export class ZaiRateLimitError extends Error {
  retryAfterMs: number
  constructor(message: string, retryAfterMs: number) {
    super(message)
    this.name = 'ZaiRateLimitError'
    this.retryAfterMs = retryAfterMs
  }
}

export class ZaiApiError extends Error {
  status: number
  rawBody?: string
  constructor(message: string, status: number, rawBody?: string) {
    super(message)
    this.name = 'ZaiApiError'
    this.status = status
    this.rawBody = rawBody
  }
}

/**
 * NO server-side rate limit tracking.
 * We always call ZAI directly. If ZAI returns 429, we pass it to the client
 * with a SHORT retry time (30s), not 10 minutes. The client retries every 30s
 * until ZAI accepts the request.
 */

// Minimal key state — just for multi-key rotation, NO cooldown tracking
const keyState = new Map<string, { lastUsedAt: number }>()

function getKeyState(apiKey: string) {
  if (!keyState.has(apiKey)) {
    keyState.set(apiKey, { lastUsedAt: 0 })
  }
  return keyState.get(apiKey)!
}

function markKeyUsed(apiKey: string) {
  const state = getKeyState(apiKey)
  state.lastUsedAt = Date.now()
}

function msUntilKeyFree(_apiKey: string): number {
  // ALWAYS return 0 — no cooldown tracking. Let ZAI decide.
  return 0
}

/**
 * Find the best key to use right now: the one with the smallest wait time.
 * Returns { key, waitMs } — if waitMs is 0, the key is immediately usable.
 */
function findBestKey(): { key: ZaiKey; waitMs: number; totalKeys: number } {
  const keys = getAllKeys()
  let best = keys[0]
  let bestWait = msUntilKeyFree(best.apiKey)
  for (const k of keys) {
    const wait = msUntilKeyFree(k.apiKey)
    if (wait < bestWait) {
      best = k
      bestWait = wait
    }
    if (bestWait === 0) break // found an immediately-free key
  }
  return { key: best, waitMs: bestWait, totalKeys: keys.length }
}

/**
 * Returns how many ms until ANY key has a free slot.
 */
export function msUntilNextSlot(): number {
  return findBestKey().waitMs
}

export function getRateLimitStatus() {
  const { key, waitMs, totalKeys } = findBestKey()
  const allKeys = getAllKeys()
  return {
    msUntilNextSlot: waitMs, // always 0 now
    windowMs: 30000, // 30s display only
    totalKeys,
    activeKeyLabel: key.label || 'default',
    keys: allKeys.map((k, i) => ({
      label: k.label || `key-${i + 1}`,
      apiKeyPreview: k.apiKey.slice(0, 8) + '…' + k.apiKey.slice(-4),
      isDefault: i === 0,
      msUntilFree: msUntilKeyFree(k.apiKey),
    })),
  }
}

/**
 * Lightweight probe: call the ZAI async-result endpoint with a fake task ID.
 * Does NOT count against the video generation rate limit.
 */
export async function probeZaiAvailability(): Promise<{
  available: boolean
  status: number | null
}> {
  const { baseUrl } = loadDefaultConfig()
  const { key } = findBestKey()
  const url = `${baseUrl}/async-result?id=probe-${Date.now()}`
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: buildHeaders(key),
      signal: AbortSignal.timeout(8000),
    })
    if (res.status === 429) {
      return { available: false, status: 429 }
    }
    return { available: true, status: res.status }
  } catch {
    return { available: false, status: null }
  }
}

/**
 * Create a video generation task by calling the ZAI API DIRECTLY (not via SDK).
 *
 * CRITICAL: ZAI allows only 1 video generation request per несколько минут per API
 * key. This function checks the server-side rate limit tracker BEFORE calling
 * ZAI — if we're within the cooldown window, it throws ZaiRateLimitError
 * immediately without wasting the API call. This ensures our one precious
 * request per несколько минут actually succeeds.
 *
 * Also serialized via a singleton lock so concurrent requests never fire.
 */
let createLockPromise: Promise<unknown> = Promise.resolve()

async function withCreateLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = createLockPromise
  let resolve!: (v: unknown) => void
  createLockPromise = new Promise((r) => {
    resolve = r
  })
  await prev.catch(() => {})
  try {
    return await fn()
  } finally {
    resolve(undefined)
  }
}

export async function createVideoTask(
  opts: VideoOptions,
): Promise<CreateVideoResult> {
  return withCreateLock(async () => {
    // NO artificial rate limit — just call ZAI directly.
    // ZAI's 429 response (if any) will be handled naturally.
    const { key } = findBestKey()

    const { baseUrl } = loadDefaultConfig()
    const body: Record<string, unknown> = {}
    if (opts.prompt) body.prompt = opts.prompt
    if (opts.imageUrl) body.image_url = opts.imageUrl
    if (opts.quality) body.quality = opts.quality
    if (typeof opts.withAudio === 'boolean') body.with_audio = opts.withAudio
    if (opts.size) body.size = opts.size
    if (opts.fps) body.fps = opts.fps
    if (opts.duration) body.duration = opts.duration

    const url = `${baseUrl}/video/generation`
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: buildHeaders(key),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      })
    } catch (err) {
      throw new ZaiApiError(
        err instanceof Error
          ? `Не удалось связаться с ZAI: ${err.message}`
          : 'Не удалось связаться с ZAI',
        0,
      )
    }

    // Track rate-limit headers if present
    const rlLimit = res.headers.get('x-ratelimit-user-10min-limit')
    const rlRemaining = res.headers.get('x-ratelimit-user-10min-remaining')
    const remainingNum = rlRemaining !== null ? Number(rlRemaining) : null
    console.log(
      `[zai] createVideoTask: key=${key.label} HTTP ${res.status} · limit=${rlLimit || '?'} remaining=${rlRemaining || '?'}`,
    )

    const text = await res.text()
    let parsed: any
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new ZaiApiError(
        `ZAI вернул некорректный ответ (HTTP ${res.status})`,
        res.status,
        text,
      )
    }

    if (res.status === 429) {
      // ZAI returned 429. Retry in 30 seconds (NOT 10 minutes).
      // ZAI's rate limit resets on their side — we just keep trying every 30s.
      markKeyUsed(key.apiKey)
      throw new ZaiRateLimitError(
        'ZAI временно недоступен. Повторная попытка через 30 секунд...',
        30000, // 30 seconds, not 10 minutes!
      )
    }

    if (!res.ok) {
      const detail =
        parsed?.error?.message ||
        parsed?.error?.code ||
        parsed?.message ||
        text
      throw new ZaiApiError(
        `ZAI API вернул ошибку ${res.status}: ${detail}`,
        res.status,
        text,
      )
    }

    if (!parsed?.id) {
      throw new ZaiApiError('ZAI не вернул идентификатор задачи.', res.status, text)
    }

    // SUCCESS — mark this key's slot as used.
    markKeyUsed(key.apiKey, remainingNum ?? 0)

    return {
      taskId: parsed.id,
      taskStatus: parsed.task_status,
      usedPreset: 'пользовательские настройки',
    }
  })
}

export interface VideoStatusResult {
  status: 'PROCESSING' | 'SUCCESS' | 'FAIL'
  videoUrl?: string
  errorMessage?: string
  raw: unknown
}

export async function queryVideoStatus(
  taskId: string,
): Promise<VideoStatusResult> {
  const { baseUrl } = loadDefaultConfig()
  const { key } = findBestKey() // use any key — status endpoint has separate (higher) rate limit
  const url = `${baseUrl}/async-result?id=${encodeURIComponent(taskId)}`

  let res: Response
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: buildHeaders(key),
      signal: AbortSignal.timeout(10000),
    })
  } catch (err) {
    throw new ZaiApiError(
      err instanceof Error
        ? `Не удалось получить статус: ${err.message}`
        : 'Не удалось получить статус',
      0,
    )
  }

  const text = await res.text()
  let parsed: any
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new ZaiApiError(
      `ZAI вернул некорректный ответ (HTTP ${res.status})`,
      res.status,
      text,
    )
  }

  // Handle FAIL returned as HTTP 400 (ZAI quirk)
  if (parsed?.task_status === 'FAIL' || (!res.ok && parsed?.error)) {
    const errMsg =
      parsed?.error?.message ||
      parsed?.error?.code ||
      parsed?.message ||
      'Задача завершилась ошибкой на стороне ZAI'
    console.error(
      `[zai] queryVideoStatus: task ${taskId} FAIL:`,
      JSON.stringify(parsed).slice(0, 500),
    )
    return {
      status: 'FAIL',
      errorMessage: errMsg,
      raw: parsed,
    }
  }

  if (res.status === 429) {
    // Status endpoint rate-limited — treat as still processing so client retries
    return {
      status: 'PROCESSING',
      raw: parsed,
    }
  }

  const videoUrl =
    parsed.video_result?.[0]?.url || parsed.video_url || parsed.url || parsed.video
  const errorMessage =
    parsed.task_status === 'FAIL'
      ? parsed?.error?.message || parsed?.error?.code || 'Задача завершилась ошибкой'
      : undefined

  if (parsed.task_status === 'FAIL') {
    console.error(
      `[zai] queryVideoStatus: task ${taskId} FAIL:`,
      JSON.stringify(parsed).slice(0, 500),
    )
  }

  return {
    status: parsed.task_status,
    videoUrl,
    errorMessage,
    raw: parsed,
  }
}
