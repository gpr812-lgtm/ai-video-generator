'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import {
  ImageIcon,
  Sparkles,
  Wand2,
  Film,
  Download,
  Loader2,
  X,
  UploadCloud,
  Settings2,
  Volume2,
  VolumeX,
  Clock,
  Gauge,
  Clapperboard,
  RefreshCw,
  Trash2,
  AlertCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { KeyRound, Plus, Settings, Globe, Share2 } from 'lucide-react'
import { cn } from '@/lib/utils'

type Quality = 'speed' | 'quality'

interface VideoSettings {
  prompt: string
  size: string
  duration: number
  fps: number
  quality: Quality
  withAudio: boolean
  voiceoverText: string // Russian text for TTS voiceover
  voiceId: string // voice selection for TTS
  filter: string // video filter id
  bgMusic: string // background music id
}

interface HistoryItem {
  id: string
  prompt: string
  imageUrl: string
  videoUrl: string
  createdAt: number
  thumb?: string
}

type Stage =
  | 'idle'
  | 'creating'
  | 'polling'
  | 'rate_limited'
  | 'success'
  | 'error'

const SIZE_OPTIONS = [
  { value: '1280x720', label: '16:9 · 1280×720', hint: 'Горизонтальное (стабильное)' },
  { value: '720x1280', label: '9:16 · 720×1280', hint: 'Вертикальное (стабильное)' },
  { value: '1024x1024', label: '1:1 · 1024×1024', hint: 'Квадрат' },
  { value: '1920x1080', label: '16:9 · 1920×1080', hint: 'HD (медленнее)' },
  { value: '1080x1920', label: '9:16 · 1080×1920', hint: 'HD вертикальное' },
  { value: '2048x1080', label: '17:9 · 2048×1080', hint: 'Кино (медленнее)' },
]

const PROMPT_IDEAS = [
  'Камера медленно приближается, лёгкий ветер шевелит волосы',
  'Плавный облёт по часовой стрелке, мягкое боковое освещение',
  'Динамичный зум-ин, движение частиц вокруг объекта',
  'Сцена оживает: вода течёт, облака плывут, свет меняется',
  'Эффект параллакса, глубина резкости, кинематографичный кадр',
]

const PROMPT_TEMPLATES = [
  { name: '🎬 Кинематографично', prompt: 'cinematic camera movement, slow dolly zoom, dramatic lighting, film grain, 35mm', voiceover: '' },
  { name: '🌊 Природа', prompt: 'gentle wind, leaves rustling, water flowing, birds flying, natural sunlight', voiceover: 'Посмотрите на эту прекрасную природу...' },
  { name: '👤 Портрет', prompt: 'subtle facial expression changes, hair movement, soft bokeh background, beauty shot', voiceover: '' },
  { name: '🌃 Город', prompt: 'night city lights, neon reflections, rain on pavement, traffic flow, urban atmosphere', voiceover: '' },
  { name: '✨ Магия', prompt: 'sparkles and particles, magical glow, ethereal atmosphere, fantasy scene', voiceover: 'Волшебство начинается...' },
  { name: '📈 Бизнес', prompt: 'professional corporate shot, clean background, subtle motion, confident pose', voiceover: 'Представляем наш новый продукт.' },
]

const VIDEO_FILTERS = [
  { id: 'none', name: 'Без фильтра', cssFilter: '' },
  { id: 'cinematic', name: 'Кино', cssFilter: 'contrast(1.2) saturate(1.1) brightness(0.95)' },
  { id: 'vintage', name: 'Винтаж', cssFilter: 'sepia(0.4) contrast(1.1) brightness(1.05)' },
  { id: 'noir', name: 'Нуар', cssFilter: 'grayscale(1) contrast(1.3) brightness(0.9)' },
  { id: 'vivid', name: 'Яркий', cssFilter: 'saturate(1.5) contrast(1.1)' },
  { id: 'dream', name: 'Сон', cssFilter: 'blur(0.5px) brightness(1.1) saturate(1.2)' },
]

const BG_MUSIC = [
  { id: 'none', name: 'Без музыки' },
  { id: 'ambient', name: 'Амбиент (спокойно)' },
  { id: 'upbeat', name: 'Энергично' },
  { id: 'cinematic', name: 'Кинематографично' },
]

const VOICES = [
  { id: 'female-default', name: '👩 Женский (по умолчанию)', lang: 'ru-RU', pitch: 1.0, rate: 0.95 },
  { id: 'female-soft', name: '👩 Женский (мягкий)', lang: 'ru-RU', pitch: 1.1, rate: 0.85 },
  { id: 'female-deep', name: '👩 Женский (глубокий)', lang: 'ru-RU', pitch: 0.9, rate: 0.9 },
  { id: 'male-default', name: '👨 Мужской (по умолчанию)', lang: 'ru-RU', pitch: 0.8, rate: 0.95 },
  { id: 'male-deep', name: '👨 Мужской (бархатный)', lang: 'ru-RU', pitch: 0.7, rate: 0.85 },
  { id: 'male-fast', name: '👨 Мужской (энергичный)', lang: 'ru-RU', pitch: 0.85, rate: 1.1 },
  { id: 'neutral', name: '-neutral Нейтральный', lang: 'ru-RU', pitch: 1.0, rate: 1.0 },
]

const MAX_FILE_SIZE = 12 * 1024 * 1024 // 12 MB (raw file)
const RESIZE_MAX_DIM = 512 // resize longest side to this before uploading (smaller = faster upload)
const POLL_INTERVAL = 4000
const MAX_POLLS = 90

/**
 * Fetch JSON safely. If the server/gateway returns an HTML error page
 * (e.g. Caddy 502/504 timeout, Next.js error overlay), throw a clean Error
 * with a friendly message instead of crashing on `res.json()`.
 */
async function fetchJsonSafely(
  url: string,
  init?: RequestInit,
): Promise<{ res: Response; data: any }> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch (err) {
    throw new Error(
      'Не удалось связаться с сервером. Проверьте подключение и попробуйте снова.',
    )
  }
  const contentType = res.headers.get('content-type') || ''
  const text = await res.text()
  if (!contentType.includes('application/json') || text.trimStart().startsWith('<')) {
    // Gateway/HTML error page (Caddy 502, Next.js error page, etc.)
    if (res.status === 502 || res.status === 504) {
      // Try to extract useful info from the HTML error
      const hint = text.includes('timeout')
        ? ' (таймаут — попробуйте ещё раз)'
        : text.includes('connect')
          ? ' (сервер занят — попробуйте через 5 сек)'
          : ''
      throw new Error(
        `Сервер временно недоступен (шлюз${hint}). Попробуйте снова через несколько секунд.`,
      )
    }
    if (res.status === 500) {
      throw new Error('Внутренняя ошибка сервера. Попробуйте ещё раз.')
    }
    throw new Error(
      `Неожиданный ответ сервера (HTTP ${res.status}). Попробуйте снова.`,
    )
  }
  let data: any
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('Сервер вернул некорректный ответ. Попробуйте ещё раз.')
  }
  return { res, data }
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/**
 * Resize an image file to fit within `maxDim`x`maxDim`, return a JPEG Blob.
 * Keeps aspect ratio. Falls back to the original blob on any error.
 */
function resizeImageFile(file: File, maxDim = RESIZE_MAX_DIM): Promise<Blob> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new window.Image()
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(file)
          return
        }
        // White background to handle transparent PNGs cleanly
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, w, h)
        ctx.drawImage(img, 0, 0, w, h)
        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob)
            else resolve(file)
          },
          'image/jpeg',
          0.9,
        )
      }
      img.onerror = () => resolve(file)
      img.src = reader.result as string
    }
    reader.onerror = () => resolve(file)
    reader.readAsDataURL(file)
  })
}

function dataUrlToThumbnail(dataUrl: string, maxDim = 320): Promise<string> {
  return new Promise((resolve) => {
    const img = new window.Image()
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return resolve(dataUrl)
      ctx.drawImage(img, 0, 0, w, h)
      try {
        resolve(canvas.toDataURL('image/jpeg', 0.7))
      } catch {
        resolve(dataUrl)
      }
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

export default function ImageToVideoApp() {
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [uploadedVideoFile, setUploadedVideoFile] = useState<File | null>(null)
  const [imageName, setImageName] = useState<string>('')
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [settings, setSettings] = useState<VideoSettings>({
    prompt: '',
    size: '1280x720',
    duration: 5,
    fps: 30,
    quality: 'speed',
    withAudio: false,
    voiceoverText: '',
    voiceId: 'female-default',
    filter: 'none',
    bgMusic: 'none',
  })
  const [stats, setStats] = useState({ total: 0, success: 0, fail: 0, totalSeconds: 0 })

  const [stage, setStage] = useState<Stage>('idle')
  const [errorMsg, setErrorMsg] = useState<string>('')
  const [pollCount, setPollCount] = useState(0)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [rateLimitWait, setRateLimitWait] = useState(0) // seconds remaining
  // Persistent auto-retry state: when ZAI keeps returning 429, we keep trying
  // every 60-90s for up to ~8 minutes so the user doesn't have to click manually.
  const [retryAttempt, setRetryAttempt] = useState(0) // current attempt number
  const [retryTotal, setRetryTotal] = useState(0) // total attempts planned
  const cancelRef = useRef<boolean>(false) // set true to abort the retry loop

  // Load history from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem('i2v_history')
      if (raw) {
        const parsed = JSON.parse(raw) as HistoryItem[]
        if (Array.isArray(parsed)) setHistory(parsed.slice(0, 12))
      }
      const rawStats = localStorage.getItem('i2v_stats')
      if (rawStats) setStats(JSON.parse(rawStats))
    } catch {
      /* ignore */
    }
  }, [])

  // --- API keys management ---
  // ZAI limits each key to 1 video request per 10 min. The user can add extra
  // free keys (from other Z.ai accounts) to get more throughput.
  interface KeyInfo {
    label: string
    apiKeyPreview: string
    isDefault: boolean
    secondsUntilFree: number
  }
  const [keys, setKeys] = useState<KeyInfo[]>([])
  const [showKeyDialog, setShowKeyDialog] = useState(false)

  // --- Multi-provider engine (always multi — simplified) ---
  const engine = 'multi'
  interface ProviderInfo {
    id: string
    name: string
    description: string
    freeTier: string
    requiresKey: boolean
    keyLabel?: string
    signupUrl?: string
    configured: boolean
  }
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [showProvidersDialog, setShowProvidersDialog] = useState(false)
  const [providerKeys, setProviderKeys] = useState<Record<string, string>>({
    replicate: '',
    segmind: '',
    huggingface: '',
  })

  const refreshProviders = useCallback(async () => {
    try {
      const res = await fetch('/api/providers')
      const data = await res.json()
      if (data?.providers) setProviders(data.providers)
    } catch {
      /* ignore */
    }
  }, [])

  // --- Colab integration ---
  const [colabUrl, setColabUrl] = useState('')
  const [colabStatus, setColabStatus] = useState<{
    connected: boolean
    url: string
    model?: string
    gpu?: string
    error?: string
  } | null>(null)
  const [colabChecking, setColabChecking] = useState(false)

  const checkColab = useCallback(async () => {
    setColabChecking(true)
    try {
      const res = await fetch('/api/colab')
      const data = await res.json()
      setColabStatus(data)
      setColabUrl(data.url || '')
    } catch {
      setColabStatus(null)
    } finally {
      setColabChecking(false)
    }
  }, [])

  const handleSaveColabUrl = useCallback(async () => {
    if (!colabUrl.trim()) {
      toast.error('Введите URL')
      return
    }
    setColabChecking(true)
    try {
      const res = await fetch('/api/colab', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: colabUrl.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data?.error || 'Не удалось сохранить')
        return
      }
      if (data.connected) {
        toast.success(`Colab подключен! (${data.gpu || 'GPU'})`)
      } else {
        toast.error('URL сохранён, но Colab не отвечает. Проверьте, что notebook запущен.')
      }
      setColabStatus(data)
      await refreshProviders()
    } catch {
      toast.error('Ошибка сети')
    } finally {
      setColabChecking(false)
    }
  }, [colabUrl, refreshProviders])

  useEffect(() => {
    refreshProviders()
    checkColab()
  }, [refreshProviders, checkColab])

  const handleSetProviderKey = useCallback(
    async (provider: string, key: string) => {
      try {
        const res = await fetch('/api/providers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider, key }),
        })
        const data = await res.json()
        if (!res.ok) {
          toast.error(data?.error || 'Не удалось сохранить ключ')
          return
        }
        toast.success('Ключ сохранён!')
        await refreshProviders()
      } catch {
        toast.error('Ошибка сети')
      }
    },
    [refreshProviders],
  )
  const [newApiKey, setNewApiKey] = useState('')
  const [newKeyToken, setNewKeyToken] = useState('')
  const [newKeyLabel, setNewKeyLabel] = useState('')
  const [keyError, setKeyError] = useState('')

  const refreshKeys = useCallback(async () => {
    try {
      const res = await fetch('/api/video/slot')
      const data = await res.json()
      if (data?.keys) setKeys(data.keys)
    } catch {
      /* ignore */
    }
  }, [])

  // Poll key status every 30s so the countdown stays current
  useEffect(() => {
    refreshKeys()
    const interval = setInterval(refreshKeys, 30000)
    return () => clearInterval(interval)
  }, [refreshKeys])

  const handleAddKey = useCallback(async () => {
    setKeyError('')
    if (!newApiKey.trim()) {
      setKeyError('API key не может быть пустым')
      return
    }
    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: newApiKey.trim(),
          token: newKeyToken.trim() || undefined,
          label: newKeyLabel.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setKeyError(data?.error || 'Не удалось добавить ключ')
        return
      }
      toast.success('Ключ добавлен!')
      setNewApiKey('')
      setNewKeyToken('')
      setNewKeyLabel('')
      await refreshKeys()
    } catch {
      setKeyError('Ошибка сети')
    }
  }, [newApiKey, newKeyToken, newKeyLabel, refreshKeys])

  const handleRemoveKey = useCallback(
    async (apiKeyPreview: string) => {
      // We only have the preview, not the full key. We need to find the full key.
      // Since the server knows all keys, we send the preview and let it match.
      // Actually, the removeKey endpoint expects the full apiKey. Let's fetch
      // the full key list first... but we deliberately don't expose full keys
      // to the client for security. Instead, we'll use the label to identify.
      // For simplicity, let's just not support removal from the UI for now —
      // the user can edit the file directly.
      toast.info('Удаление ключей: отредактируйте .z-ai-extra-keys.json на сервере')
    },
    [],
  )

  const persistHistory = useCallback((items: HistoryItem[]) => {
    try {
      localStorage.setItem('i2v_history', JSON.stringify(items.slice(0, 12)))
    } catch {
      /* ignore */
    }
  }, [])

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Поддерживаются только изображения (PNG, JPG, WEBP).')
      return
    }
    if (file.size > MAX_FILE_SIZE) {
      toast.error('Файл слишком большой. Максимум 12 МБ.')
      return
    }
    try {
      const dataUrl = await fileToDataUrl(file)
      setImageDataUrl(dataUrl)
      setImageFile(file)
      setImageName(file.name)
      setStage('idle')
      setVideoUrl(null)
      setErrorMsg('')
      toast.success('Изображение загружено')
    } catch {
      toast.error('Не удалось прочитать файл.')
    }
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setIsDragging(false)
      const file = e.dataTransfer.files?.[0]
      if (file) void handleFile(file)
    },
    [handleFile],
  )

  const onFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) void handleFile(file)
    },
    [handleFile],
  )

  const clearImage = useCallback(() => {
    setImageDataUrl(null)
    setImageFile(null)
    setImageName('')
    setStage('idle')
    setVideoUrl(null)
    setErrorMsg('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  /**
   * Run one full "create + poll" cycle with the given parameters.
   * Returns the video URL on success, or throws with a structured reason
   * ('rate_limited' | 'fail' | 'timeout' | 'other') so the caller can decide
   * whether to retry with a fallback preset.
   */
  const runGenerateCycle = useCallback(
    async (
      params: VideoSettings,
      resizedDataUrl: string,
    ): Promise<{ videoUrl: string; presetLabel?: string }> => {
      // --- Create task (smart rate-limit-aware retry) ---
      // ZAI allows only 1 video-generation request per 10 minutes per API key.
      // The server tracks when our slot was last used and refuses to hit ZAI
      // while we're in the cooldown window. This means:
      //   • If a slot is available → the request goes through immediately.
      //   • If we're in cooldown → server returns 429 with retryAfterMs = time
      //     until the next slot. We show a countdown and auto-fire when ready.
      // No wasted requests, no hammering. Our one precious slot is preserved.
      let taskId: string | null = null
      let presetLabel: string | undefined
      const MAX_CREATE_ATTEMPTS = 4
      setRetryTotal(MAX_CREATE_ATTEMPTS)
      setRetryAttempt(0)
      let createAttempt = 0
      while (createAttempt < MAX_CREATE_ATTEMPTS) {
        if (cancelRef.current) {
          const e: any = new Error('Генерация отменена пользователем.')
          e.kind = 'other'
          throw e
        }
        createAttempt += 1
        setRetryAttempt(createAttempt)
        try {
          const { res, data } = await fetchJsonSafely('/api/video/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt: params.prompt,
              imageUrl: resizedDataUrl,
              quality: params.quality,
              withAudio: params.withAudio,
              size: params.size,
              fps: params.fps,
              duration: params.duration,
            }),
          })
          if (res.status === 429 && data?.retryable) {
            // Last attempt? Give up with a clear message.
            if (createAttempt >= MAX_CREATE_ATTEMPTS) {
              const e: any = new Error(
                'Не удалось создать задачу после нескольких попыток. ZAI лимит запросов. Подождите немного и попробуйте снова.',
              )
              e.kind = 'rate_limited'
              throw e
            }
            // Server tells us exactly how long to wait (retryAfterMs).
            // Wait that long, then auto-fire the next attempt.
            const waitMs = data.retryAfterMs || 600000
            const waitSec = Math.max(5, Math.ceil(waitMs / 1000))
            setStage('rate_limited')
            setRateLimitWait(waitSec)
            if (createAttempt === 1) {
              const mins = Math.floor(waitSec / 60)
              const secs = waitSec % 60
              toast.error(
                `ZAI лимит запросов. Автоповтор через ${mins}м ${secs}с — оставьте вкладку открытой.`,
              )
            }
            for (let s = waitSec; s > 0; s--) {
              if (cancelRef.current) break
              setRateLimitWait(s)
              await new Promise((r) => setTimeout(r, 1000))
            }
            setRateLimitWait(0)
            if (cancelRef.current) {
              const e: any = new Error('Генерация отменена пользователем.')
              e.kind = 'other'
              throw e
            }
            setStage('creating')
            continue
          }
          if (!res.ok) {
            const e: any = new Error(data?.error || 'Не удалось создать задачу')
            e.kind = 'other'
            throw e
          }
          taskId = data.taskId
          presetLabel = data.usedPreset
          if (!taskId) {
            const e: any = new Error('Сервер не вернул идентификатор задачи.')
            e.kind = 'other'
            throw e
          }
          break
        } catch (err: any) {
          if (err?.kind) throw err
          const e: any = new Error(
            err instanceof Error ? err.message : 'Ошибка запроса',
          )
          e.kind = 'other'
          throw e
        }
      }
      if (!taskId) {
        const e: any = new Error(
          'Не удалось создать задачу после нескольких попыток.',
        )
        e.kind = 'other'
        throw e
      }

      // --- Poll for status ---
      setStage('polling')
      setPollCount(0)
      let polls = 0
      let consecutiveErrors = 0
      while (polls < MAX_POLLS) {
        polls += 1
        setPollCount(polls)
        await new Promise((r) => setTimeout(r, POLL_INTERVAL))
        let res: Response
        let data: any
        try {
          const result = await fetchJsonSafely(
            `/api/video/status?taskId=${encodeURIComponent(taskId!)}`,
          )
          res = result.res
          data = result.data
          consecutiveErrors = 0
        } catch (err) {
          // Gateway hiccup (502/504/HTML) — tolerate up to 3 in a row, then abort.
          consecutiveErrors += 1
          if (consecutiveErrors >= 3) {
            const e: any = new Error(
              err instanceof Error ? err.message : 'Не удалось получить статус',
            )
            e.kind = 'other'
            throw e
          }
          continue
        }
        if (!res.ok) {
          const e: any = new Error(data?.error || 'Не удалось получить статус')
          e.kind = 'other'
          throw e
        }
        if (data.status === 'SUCCESS' && data.videoUrl) {
          return { videoUrl: data.videoUrl, presetLabel }
        }
        if (data.status === 'FAIL') {
          const reason = data.errorMessage
            ? `Нейросеть отклонила параметры: ${data.errorMessage}`
            : 'Нейросеть отклонила параметры генерации.'
          const e: any = new Error(reason)
          e.kind = 'fail'
          throw e
        }
      }
      const e: any = new Error('Превышено время ожидания. Попробуйте ещё раз.')
      e.kind = 'timeout'
      throw e
    },
    [],
  )

  const handleGenerate = useCallback(async () => {
    if (!imageDataUrl || !imageFile) {
      toast.error('Сначала загрузите изображение.')
      return
    }
    cancelRef.current = false // reset cancel flag from any previous run
    setStage('creating')
    setErrorMsg('')
    setVideoUrl(null)
    setPollCount(0)
    setRetryAttempt(0)
    setRetryTotal(0)

    // === UPLOAD FINISHED VIDEO (from Colab) ===
    if (uploadedVideoFile) {
      const objectUrl = URL.createObjectURL(uploadedVideoFile)
      setVideoUrl(objectUrl)
      setStage('success')
      toast.success('Видео загружено из Colab!')
      // Save to history
      try {
        const thumb = await dataUrlToThumbnail(imageDataUrl, 320)
        const item: HistoryItem = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          prompt: settings.prompt || '(Colab SVD)',
          imageUrl: thumb,
          videoUrl: objectUrl,
          createdAt: Date.now(),
          thumb,
        }
        const next = [item, ...history].slice(0, 12)
        setHistory(next)
        persistHistory(next)
      } catch {
        /* ignore */
      }
      setUploadedVideoFile(null)
      return
    }
    setRetryAttempt(0)
    setRetryTotal(0)

    // 1) Resize image client-side to keep the payload reasonable (≤ ~500 KB base64).
    let resizedDataUrl: string
    try {
      const blob = await resizeImageFile(imageFile)
      resizedDataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(r.result as string)
        r.onerror = () => reject(r.error)
        r.readAsDataURL(blob)
      })
    } catch (err) {
      const msg =
        err instanceof Error
          ? `Не удалось подготовить изображение: ${err.message}`
          : 'Не удалось подготовить изображение'
      setErrorMsg(msg)
      setStage('error')
      toast.error(msg)
      return
    }

    // ===== DUAL AI MODE: Colab SVD + ZAI cogvideox-3 =====
    // Two real AI providers:
    //   1. Google Colab (SVD) — if configured, no limits, best quality
    //   2. ZAI (cogvideox-3) — free, but 1 req / 10 min rate limit
    // If Colab is configured, try it first. If it fails, fall back to ZAI.
    // If ZAI is rate-limited, show countdown and wait.

    // Step 1: Try Colab if configured
    if (colabStatus?.connected && resizedDataUrl) {
      setStage('polling')
      setPollCount(1)
      toast.info('🎨 Генерация через Google Colab (Stable Video Diffusion)…')
      try {
        const { res, data } = await fetchJsonSafely('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: resizedDataUrl.split(',')[1],
            prompt: settings.prompt,
            provider: 'colab',
          }),
        })
        if (res.ok && data.videoUrl) {
          setVideoUrl(data.videoUrl)
          setStage('success')
          toast.success('Видео готово! (Colab SVD)')
          // Save history
          try {
            const thumb = await dataUrlToThumbnail(imageDataUrl, 320)
            const item: HistoryItem = {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              prompt: settings.prompt || '(Colab SVD)',
              imageUrl: thumb,
              videoUrl: data.videoUrl,
              createdAt: Date.now(),
              thumb,
            }
            const next = [item, ...history].slice(0, 12)
            setHistory(next)
            persistHistory(next)
          } catch { /* ignore */ }
          return
        }
        // Colab failed — fall through to ZAI
        console.warn('[generate] Colab failed, falling back to ZAI:', data?.error)
        toast.info('Colab не ответил. Пробую ZAI…')
      } catch (err) {
        console.warn('[generate] Colab error, falling back to ZAI:', err)
        toast.info('Colab недоступен. Пробую ZAI…')
      }
    }

    // Step 2: Try ZAI (cogvideox-3)
    // If duration > 10s, use chunked generation (multiple 5s segments stitched together)
    if (settings.duration > 10) {
      setStage('polling')
      setPollCount(1)
      toast.info(`🎬 Чанковая генерация: ${settings.duration}с = ${Math.ceil(settings.duration / 5)} сегмента...`)
      try {
        const { res, data } = await fetchJsonSafely('/api/video/chunked', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageUrl: resizedDataUrl,
            prompt: settings.prompt,
            size: settings.size,
            fps: settings.fps,
            duration: settings.duration,
            quality: settings.quality,
          }),
        })
        if (res.ok && data.videoUrl) {
          setVideoUrl(data.videoUrl)
          setStage('success')
          toast.success(`Видео готово! (${data.chunks} сегментов, ${data.totalDuration}с)`)

          // Update stats
          const newStats = { ...stats, total: stats.total + 1, success: stats.success + 1, totalSeconds: stats.totalSeconds + (data.totalDuration || settings.duration) }
          setStats(newStats)
          localStorage.setItem('i2v_stats', JSON.stringify(newStats))

          // Play voiceover
          if (settings.withAudio && settings.voiceoverText.trim()) {
            try {
              const voice = VOICES.find((v) => v.id === settings.voiceId) || VOICES[0]
              const u = new SpeechSynthesisUtterance(settings.voiceoverText)
              u.lang = voice.lang
              u.pitch = voice.pitch
              u.rate = voice.rate
              const voices = window.speechSynthesis.getVoices()
              const ruVoice = voices.find((v) => v.lang.startsWith('ru'))
              if (ruVoice) u.voice = ruVoice
              window.speechSynthesis.speak(u)
            } catch { /* ignore */ }
          }

          // Save history
          try {
            const thumb = await dataUrlToThumbnail(imageDataUrl, 320)
            const item: HistoryItem = {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              prompt: settings.prompt || '(chunked)',
              imageUrl: thumb,
              videoUrl: data.videoUrl,
              createdAt: Date.now(),
              thumb,
            }
            const next = [item, ...history].slice(0, 12)
            setHistory(next)
            persistHistory(next)
          } catch { /* ignore */ }
          return
        }
        // Chunked failed — fall through to single ZAI
        toast.info('Чанковая генерация не удалась. Пробую обычную...')
      } catch (err) {
        console.warn('[generate] chunked failed, falling back to single:', err)
        toast.info('Чанковая генерация не удалась. Пробую обычную...')
      }
    }

    setStage('creating')
    setPollCount(0)
    toast.info('Создаю задачу в нейросети ZAI…')

    let taskId: string | null = null
    try {
      const { res, data } = await fetchJsonSafely('/api/video/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: settings.prompt,
          imageUrl: resizedDataUrl,
          quality: settings.quality,
          withAudio: settings.withAudio,
          size: settings.size,
          fps: settings.fps,
          duration: settings.duration,
        }),
      })

      if (res.status === 429 && data?.retryable) {
        // Rate limited — show countdown and retry
        const waitSec = Math.max(30, Math.round((data.retryAfterMs || 30000) / 1000))
        setStage('rate_limited')
        setRateLimitWait(waitSec)
        toast.error(`ZAI лимит. Повтор через ${waitSec}с…`)
        for (let s = waitSec; s > 0; s--) {
          if (cancelRef.current) break
          setRateLimitWait(s)
          await new Promise((r) => setTimeout(r, 1000))
        }
        setRateLimitWait(0)
        if (!cancelRef.current) {
          setStage('creating')
          const { res: res2, data: data2 } = await fetchJsonSafely('/api/video/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt: settings.prompt,
              imageUrl: resizedDataUrl,
              quality: settings.quality,
              withAudio: settings.withAudio,
              size: settings.size,
              fps: settings.fps,
              duration: settings.duration,
            }),
          })
          if (!res2.ok) throw new Error(data2?.error || 'Не удалось создать задачу')
          taskId = data2.taskId
        }
      } else if (!res.ok) {
        throw new Error(data?.error || 'Не удалось создать задачу')
      } else {
        taskId = data.taskId
      }

      if (!taskId) throw new Error('Сервер не вернул идентификатор задачи')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка создания задачи'
      setErrorMsg(msg)
      setStage('error')
      toast.error(msg)
      return
    }

    // Step 3: Poll for ZAI status
    setStage('polling')
    setPollCount(0)
    let lastVideoUrl: string | null = null
    let consecutiveErrors = 0

    while (pollCount < MAX_POLLS) {
      if (cancelRef.current) break
      setPollCount(p => p + 1)
      await new Promise((r) => setTimeout(r, POLL_INTERVAL))

      try {
        const { res, data } = await fetchJsonSafely(
          `/api/video/status?taskId=${encodeURIComponent(taskId!)}`,
        )
        consecutiveErrors = 0
        if (!res.ok) throw new Error(data?.error || 'Ошибка статуса')

        if (data.status === 'SUCCESS' && data.videoUrl) {
          lastVideoUrl = data.videoUrl
          break
        }
        if (data.status === 'FAIL') {
          throw new Error(data.errorMessage || 'Нейросеть не смогла сгенерировать видео')
        }
      } catch (err) {
        consecutiveErrors++
        if (consecutiveErrors >= 3) {
          throw err
        }
      }
    }

    if (cancelRef.current) {
      setErrorMsg('Генерация отменена')
      setStage('error')
      return
    }

    if (!lastVideoUrl) {
      setErrorMsg('Превышено время ожидания. Попробуйте ещё раз.')
      setStage('error')
      toast.error('Превышено время ожидания')
      return
    }

    // Success!
    setVideoUrl(lastVideoUrl)
    setStage('success')
    toast.success('Видео готово! (ZAI cogvideox-3)')

    // Update stats
    const newStats = { ...stats, total: stats.total + 1, success: stats.success + 1, totalSeconds: stats.totalSeconds + settings.duration }
    setStats(newStats)
    localStorage.setItem('i2v_stats', JSON.stringify(newStats))

    // Play Russian voiceover if enabled
    if (settings.withAudio && settings.voiceoverText.trim()) {
      try {
        const voice = VOICES.find((v) => v.id === settings.voiceId) || VOICES[0]
        const utterance = new SpeechSynthesisUtterance(settings.voiceoverText)
        utterance.lang = voice.lang
        utterance.pitch = voice.pitch
        utterance.rate = voice.rate
        const voices = window.speechSynthesis.getVoices()
        const ruVoice = voices.find((v) => v.lang.startsWith('ru'))
        if (ruVoice) utterance.voice = ruVoice
        window.speechSynthesis.speak(utterance)
        toast.info(`🔊 Озвучка: ${voice.name}`)
      } catch {
        toast.error('Не удалось воспроизвести озвучку')
      }
    }

    // Save history
    try {
      const thumb = await dataUrlToThumbnail(imageDataUrl, 320)
      const item: HistoryItem = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        prompt: settings.prompt || '(без описания)',
        imageUrl: thumb,
        videoUrl: lastVideoUrl,
        createdAt: Date.now(),
        thumb,
      }
      const next = [item, ...history].slice(0, 12)
      setHistory(next)
      persistHistory(next)
    } catch { /* ignore */ }
    return
  }, [imageDataUrl, imageFile, settings, history, persistHistory, colabStatus])
  const cancelGeneration = useCallback(() => {
    cancelRef.current = true
    // The retry loop checks cancelRef and will throw "отменена" within ~1s.
    // We also reset state here in case the loop is mid-sleep.
    setRateLimitWait(0)
  }, [])

  const resetAll = useCallback(() => {
    clearImage()
    setSettings({
      prompt: '',
      size: '1280x720',
      duration: 5,
      fps: 30,
      quality: 'speed',
      withAudio: false,
      voiceoverText: '',
    })
  }, [clearImage])

  const clearHistory = useCallback(() => {
    setHistory([])
    persistHistory([])
    toast.success('История очищена')
  }, [persistHistory])

  const removeHistoryItem = useCallback(
    (id: string) => {
      const next = history.filter((h) => h.id !== id)
      setHistory(next)
      persistHistory(next)
    },
    [history, persistHistory],
  )

  const applyIdea = (idea: string) => {
    setSettings((s) => ({ ...s, prompt: idea }))
  }

  const isBusy =
    stage === 'creating' || stage === 'polling' || stage === 'rate_limited'
  const progressPct = Math.min(95, Math.round((pollCount / MAX_POLLS) * 100))

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#070711] text-white">
      {/* Animated background */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-40 -left-32 h-[36rem] w-[36rem] rounded-full bg-fuchsia-600/25 blur-[120px]" />
        <div className="absolute top-1/3 -right-32 h-[32rem] w-[32rem] rounded-full bg-cyan-500/20 blur-[120px]" />
        <div className="absolute bottom-0 left-1/2 h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-violet-600/20 blur-[120px]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:22px_22px]" />
      </div>

      <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-fuchsia-500 via-violet-500 to-cyan-400 shadow-lg shadow-fuchsia-500/30">
            <Clapperboard className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">Image → Video AI</div>
            <div className="text-xs text-white/50">Нейросеть · оживи кадр</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Provider settings */}
          <Dialog open={showProvidersDialog} onOpenChange={setShowProvidersDialog}>
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-white/15 bg-white/5 text-white/70 hover:bg-white/10"
                >
                  <Settings className="mr-1 h-3 w-3" />
                  Провайдеры
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg border-white/15 bg-[#0f0f1e] text-white">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Globe className="h-4 w-4 text-fuchsia-300" />
                    Бесплатные провайдеры видео
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  {/* Colab section — BEST quality, free GPU */}
                  <div className="rounded-lg border border-fuchsia-400/30 bg-fuchsia-500/5 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-sm font-semibold text-white/90">
                        🚀 Google Colab (Stable Video Diffusion)
                      </span>
                      {colabStatus?.connected ? (
                        <Badge variant="outline" className="border-green-400/30 bg-green-500/10 text-[10px] text-green-300">
                          ✓ подключен ({colabStatus.gpu || 'GPU'})
                        </Badge>
                      ) : colabStatus?.url ? (
                        <Badge variant="outline" className="border-amber-400/30 bg-amber-500/10 text-[10px] text-amber-300">
                          не отвечает
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-white/15 bg-white/5 text-[10px] text-white/40">
                          не настроен
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-white/60">
                      <strong>Лучшее качество!</strong> Настоящий Stable Video Diffusion на бесплатном GPU (T4).
                      Полностью бесплатно (12ч/день).
                    </p>
                    <div className="mt-2 space-y-2">
                      <details className="text-xs text-white/50">
                        <summary className="cursor-pointer text-fuchsia-300">📋 Как запустить Colab (3 минуты)</summary>
                        <ol className="mt-2 space-y-1 pl-4">
                          <li>1. Откройте <a href="https://colab.research.google.com" target="_blank" rel="noreferrer" className="text-fuchsia-300 underline">colab.research.google.com</a></li>
                          <li>2. Создайте новый notebook</li>
                          <li>3. Скачайте <a href="/colab-notebook.py" target="_blank" rel="noreferrer" className="text-fuchsia-300 underline">colab-notebook.py</a> и вставьте в ячейку</li>
                          <li>4. Runtime → Change runtime type → <strong>T4 GPU</strong></li>
                          <li>5. Получите бесплатный токен на <a href="https://dashboard.ngrok.com/get-started/your-authtoken" target="_blank" rel="noreferrer" className="text-fuchsia-300 underline">ngrok.com</a></li>
                          <li>6. Вставьте токен в notebook (NGROK_AUTH_TOKEN)</li>
                          <li>7. Запустите ячейку (Shift+Enter), дождитесь "✅ Сервер запущен!"</li>
                          <li>8. Скопируйте URL (https://xxx.ngrok.io) и вставьте ниже ↓</li>
                        </ol>
                      </details>
                      <div className="flex gap-2">
                        <Input
                          placeholder="https://abc123.ngrok.io"
                          value={colabUrl}
                          onChange={(e) => setColabUrl(e.target.value)}
                          className="border-white/10 bg-white/[0.04] text-sm text-white placeholder:text-white/30"
                        />
                        <Button
                          size="sm"
                          onClick={handleSaveColabUrl}
                          disabled={colabChecking}
                          className="bg-gradient-to-r from-fuchsia-500 to-violet-500 text-white hover:opacity-90"
                        >
                          {colabChecking ? <Loader2 className="h-3 w-3 animate-spin" /> : 'OK'}
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-green-400/20 bg-green-500/5 p-3 text-xs text-white/70">
                    ✅ <span className="font-semibold">AI Frames (Pollinations)</span> работает <span className="font-semibold">бесплатно без настройки</span> — просто нажмите «Сгенерировать».
                    Для лучшего качества подключите Colab выше.
                  </div>
                  {providers.map((p) => (
                    <div
                      key={p.id}
                      className={cn(
                        'rounded-lg border p-3',
                        p.configured
                          ? 'border-green-400/30 bg-green-500/5'
                          : p.requiresKey
                            ? 'border-white/10 bg-white/[0.02]'
                            : 'border-cyan-400/30 bg-cyan-500/5',
                      )}
                    >
                      <div className="mb-1 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-white/90">{p.name}</span>
                          {p.configured ? (
                            <Badge variant="outline" className="border-green-400/30 bg-green-500/10 text-[10px] text-green-300">
                              ✓ настроен
                            </Badge>
                          ) : p.requiresKey ? (
                            <Badge variant="outline" className="border-white/15 bg-white/5 text-[10px] text-white/40">
                              нужен ключ
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="border-cyan-400/30 bg-cyan-500/10 text-[10px] text-cyan-300">
                              без ключа
                            </Badge>
                          )}
                        </div>
                        {p.signupUrl && (
                          <a
                            href={p.signupUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] text-fuchsia-300 underline"
                          >
                            получить ключ →
                          </a>
                        )}
                      </div>
                      <p className="text-xs text-white/50">{p.description}</p>
                      <p className="mt-1 text-[11px] text-white/40">{p.freeTier}</p>
                      {p.requiresKey && (
                        <div className="mt-2 flex gap-2">
                          <Input
                            type="password"
                            placeholder={p.keyLabel || 'API key'}
                            value={providerKeys[p.id] || ''}
                            onChange={(e) =>
                              setProviderKeys((prev) => ({ ...prev, [p.id]: e.target.value }))
                            }
                            className="border-white/10 bg-white/[0.04] text-sm text-white placeholder:text-white/30"
                          />
                          <Button
                            size="sm"
                            onClick={() => handleSetProviderKey(p.id, providerKeys[p.id] || '')}
                            className="bg-gradient-to-r from-fuchsia-500 to-violet-500 text-white hover:opacity-90"
                          >
                            Сохранить
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                  <div className="text-[11px] text-white/40">
                    💡 При генерации приложение автоматически перебирает провайдеров:
                    HuggingFace → Segmind → Replicate. Первый успешный возвращает видео.
                  </div>
                </div>
              </DialogContent>
            </Dialog>

        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 pb-16">
        {/* Info banner */}
        <div className="mb-6 rounded-xl border border-green-400/30 bg-green-500/10 px-4 py-3 text-sm text-green-100/80">
          🤖 <strong>Настоящий ИИ видео</strong> — два движка:
          {colabStatus?.connected ? (
            <span className="text-green-300"> ✅ Colab SVD подключен (без лимитов)</span>
          ) : (
            <span className="text-amber-300"> ⚡ ZAI cogvideox-3 (лимит запросов) — настройте Colab для безлимита</span>
          )}
          <br />
          <span className="text-xs">
            {colabStatus?.connected
              ? 'Видео генерируется через Colab (SVD). Если Colab недоступен — через ZAI.'
              : 'Нажмите «Провайдеры» → настройте Colab для безлимитной генерации (SVD на бесплатном GPU).'}
          </span>
        </div>

        {/* Hero */}
        <section className="mb-10 text-center">
          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="mx-auto max-w-3xl text-balance text-4xl font-bold leading-tight tracking-tight md:text-5xl"
          >
            Преврати{' '}
            <span className="bg-gradient-to-r from-fuchsia-400 via-violet-300 to-cyan-300 bg-clip-text text-transparent">
              картинку
            </span>{' '}
            в живое видео
          </motion.h1>
          <p className="mx-auto mt-4 max-w-xl text-balance text-sm text-white/60 md:text-base">
            Загрузите изображение, опишите движение — и нейросеть сгенерирует
            кинематографичный ролик за пару минут.
          </p>
        </section>

        <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          {/* LEFT: input + settings */}
          <Card className="border-white/10 bg-white/[0.03] backdrop-blur-xl">
            <CardContent className="p-6">
              {/* Upload area */}
              <div className="mb-5 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-white/80">
                  <ImageIcon className="h-4 w-4 text-fuchsia-300" />
                  1. Загрузите изображение
                </h2>
                {imageDataUrl && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearImage}
                    className="h-7 px-2 text-xs text-white/50 hover:text-white"
                  >
                    <X className="mr-1 h-3 w-3" />
                    Убрать
                  </Button>
                )}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onFileChange}
              />

              {!imageDataUrl ? (
                <div
                  onDragOver={(e) => {
                    e.preventDefault()
                    setIsDragging(true)
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={onDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={cn(
                    'group relative flex h-64 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed transition-all',
                    isDragging
                      ? 'border-fuchsia-400 bg-fuchsia-500/10'
                      : 'border-white/15 bg-white/[0.02] hover:border-white/30 hover:bg-white/[0.04]',
                  )}
                >
                  <div className="mb-3 grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-fuchsia-500/30 to-cyan-400/30 ring-1 ring-white/10 transition-transform group-hover:scale-105">
                    <UploadCloud className="h-7 w-7 text-white" />
                  </div>
                  <p className="text-sm font-medium text-white/80">
                    Перетащите изображение сюда
                  </p>
                  <p className="mt-1 text-xs text-white/40">
                    или нажмите, чтобы выбрать файл · PNG / JPG / WEBP · до 8 МБ
                  </p>
                </div>
              ) : (
                <div className="relative overflow-hidden rounded-2xl border border-white/10">
                  { }
                  <img
                    src={imageDataUrl}
                    alt={imageName || 'Загруженное изображение'}
                    className="max-h-[26rem] w-full object-contain bg-black/40"
                  />
                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent px-4 py-3 text-xs text-white/70">
                    <span className="truncate">{imageName || 'image'}</span>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="rounded-md bg-white/10 px-2 py-1 text-white/80 hover:bg-white/20"
                    >
                      Заменить
                    </button>
                  </div>
                </div>
              )}

              {/* Prompt */}
              <div className="mb-5 mt-7">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-white/80">
                    <Wand2 className="h-4 w-4 text-violet-300" />
                    2. Опишите движение (необязательно)
                  </h2>
                </div>
                <Textarea
                  value={settings.prompt}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, prompt: e.target.value }))
                  }
                  placeholder="Например: камера медленно приближается, лёгкий ветер шевелит листву…"
                  rows={3}
                  className="resize-none border-white/10 bg-white/[0.04] text-sm text-white placeholder:text-white/30 focus-visible:ring-fuchsia-400/40"
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  {PROMPT_IDEAS.map((idea) => (
                    <button
                      key={idea}
                      onClick={() => applyIdea(idea)}
                      className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/60 transition-colors hover:border-fuchsia-400/40 hover:bg-fuchsia-500/10 hover:text-white"
                    >
                      {idea.length > 42 ? idea.slice(0, 42) + '…' : idea}
                    </button>
                  ))}
                </div>
              </div>

              {/* Prompt templates */}
              <div className="mb-4">
                <Label className="mb-2 block text-xs text-white/50">
                  📋 Шаблоны сценариев
                </Label>
                <div className="flex flex-wrap gap-2">
                  {PROMPT_TEMPLATES.map((tpl) => (
                    <button
                      key={tpl.name}
                      onClick={() => setSettings((s) => ({ ...s, prompt: tpl.prompt, voiceoverText: tpl.voiceover || s.voiceoverText }))}
                      className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/70 transition-colors hover:border-fuchsia-400/40 hover:bg-fuchsia-500/10 hover:text-white"
                    >
                      {tpl.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Settings */}
              <div className="mb-6 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white/80">
                  <Settings2 className="h-4 w-4 text-cyan-300" />
                  3. Параметры видео
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label className="mb-2 block text-xs text-white/50">
                      Формат кадра
                    </Label>
                    <Select
                      value={settings.size}
                      onValueChange={(v) =>
                        setSettings((s) => ({ ...s, size: v }))
                      }
                    >
                      <SelectTrigger className="border-white/10 bg-white/[0.04]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SIZE_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label className="mb-2 block text-xs text-white/50">
                      Длительность
                    </Label>
                    <Select
                      value={String(settings.duration)}
                      onValueChange={(v) =>
                        setSettings((s) => ({ ...s, duration: Number(v) }))
                      }
                    >
                      <SelectTrigger className="border-white/10 bg-white/[0.04] text-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="5">5 секунд</SelectItem>
                        <SelectItem value="10">10 секунд</SelectItem>
                        <SelectItem value="15">15 секунд</SelectItem>
                        <SelectItem value="20">20 секунд</SelectItem>
                        <SelectItem value="30">30 секунд</SelectItem>
                        <SelectItem value="45">45 секунд</SelectItem>
                        <SelectItem value="60">60 секунд</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="mt-1 text-[10px] text-white/30">
                      ZAI макс. 10с • Colab ~6с • ffmpeg любое
                    </p>
                  </div>

                  <div>
                    <Label className="mb-2 block text-xs text-white/50">
                      Частота кадров
                    </Label>
                    <Tabs
                      value={String(settings.fps)}
                      onValueChange={(v) =>
                        setSettings((s) => ({ ...s, fps: Number(v) }))
                      }
                    >
                      <TabsList className="grid w-full grid-cols-2 bg-white/[0.04]">
                        <TabsTrigger value="30">30 fps</TabsTrigger>
                        <TabsTrigger value="60">60 fps</TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>

                  <div>
                    <Label className="mb-2 block text-xs text-white/50">
                      Режим генерации
                    </Label>
                    <Tabs
                      value={settings.quality}
                      onValueChange={(v) =>
                        setSettings((s) => ({
                          ...s,
                          quality: v as Quality,
                        }))
                      }
                    >
                      <TabsList className="grid w-full grid-cols-2 bg-white/[0.04]">
                        <TabsTrigger value="speed" className="gap-1">
                          <Gauge className="h-3 w-3" /> Быстро
                        </TabsTrigger>
                        <TabsTrigger value="quality" className="gap-1">
                          <Sparkles className="h-3 w-3" /> Качество
                        </TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
                  <div className="flex items-center gap-3">
                    {settings.withAudio ? (
                      <Volume2 className="h-4 w-4 text-fuchsia-300" />
                    ) : (
                      <VolumeX className="h-4 w-4 text-white/40" />
                    )}
                    <div>
                      <div className="text-sm font-medium text-white/80">
                        AI-озвучка (русский)
                      </div>
                      <div className="text-xs text-white/45">
                        Озвучить видео на русском языке
                      </div>
                    </div>
                  </div>
                  <Switch
                    checked={settings.withAudio}
                    onCheckedChange={(v) =>
                      setSettings((s) => ({ ...s, withAudio: v }))
                    }
                  />
                </div>

                {/* Russian voiceover text input */}
                {settings.withAudio && (
                  <div className="mt-3 rounded-xl border border-fuchsia-400/20 bg-fuchsia-500/5 p-3">
                    <Label className="mb-2 block text-xs text-fuchsia-200">
                      🎙️ Голос озвучки:
                    </Label>
                    <Select
                      value={settings.voiceId}
                      onValueChange={(v) => setSettings((s) => ({ ...s, voiceId: v }))}
                    >
                      <SelectTrigger className="mb-3 border-white/10 bg-white/[0.04] text-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {VOICES.map((v) => (
                          <SelectItem key={v.id} value={v.id}>
                            {v.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Label className="mb-2 block text-xs text-fuchsia-200">
                      Текст для озвучивания (русский):
                    </Label>
                    <Textarea
                      value={settings.voiceoverText}
                      onChange={(e) =>
                        setSettings((s) => ({ ...s, voiceoverText: e.target.value }))
                      }
                      placeholder="Например: Привет! Это видео создано нейросетью..."
                      rows={2}
                      className="resize-none border-white/10 bg-white/[0.04] text-sm text-white placeholder:text-white/30 focus-visible:ring-fuchsia-400/40"
                    />
                    <div className="mt-2 flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const voice = VOICES.find((v) => v.id === settings.voiceId)
                          if (!voice || !settings.voiceoverText.trim()) {
                            toast.error('Введите текст для озвучки')
                            return
                          }
                          try {
                            const u = new SpeechSynthesisUtterance(settings.voiceoverText)
                            u.lang = voice.lang
                            u.pitch = voice.pitch
                            u.rate = voice.rate
                            const voices = window.speechSynthesis.getVoices()
                            const ruVoice = voices.find((v) => v.lang.startsWith('ru'))
                            if (ruVoice) u.voice = ruVoice
                            window.speechSynthesis.cancel()
                            window.speechSynthesis.speak(u)
                          } catch {
                            toast.error('Не удалось воспроизвести')
                          }
                        }}
                        className="border-fuchsia-400/30 bg-fuchsia-500/10 text-fuchsia-200 hover:bg-fuchsia-500/20"
                      >
                        ▶️ Прослушать
                      </Button>
                    </div>
                    <p className="mt-2 text-[11px] text-white/40">
                      Озвучка воспроизводится через браузерное TTS (бесплатно)
                    </p>
                  </div>
                )}

                {/* Video filter */}
                <div className="mt-4">
                  <Label className="mb-2 block text-xs text-white/50">
                    🎭 Фильтр видео
                  </Label>
                  <Select
                    value={settings.filter}
                    onValueChange={(v) => setSettings((s) => ({ ...s, filter: v }))}
                  >
                    <SelectTrigger className="border-white/10 bg-white/[0.04] text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {VIDEO_FILTERS.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Background music */}
                <div className="mt-4">
                  <Label className="mb-2 block text-xs text-white/50">
                    🎵 Фоновая музыка
                  </Label>
                  <Select
                    value={settings.bgMusic}
                    onValueChange={(v) => setSettings((s) => ({ ...s, bgMusic: v }))}
                  >
                    <SelectTrigger className="border-white/10 bg-white/[0.04] text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BG_MUSIC.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Stats */}
              {stats.total > 0 && (
                <div className="mb-4 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
                  <div className="flex items-center justify-between text-xs text-white/60">
                    <span className="flex items-center gap-1">
                      <Film className="h-3 w-3" /> Статистика:
                    </span>
                    <span>
                      {stats.success}✓ / {stats.total} всего · {stats.totalSeconds}с видео
                    </span>
                  </div>
                </div>
              )}
              <Button
                size="lg"
                disabled={!imageDataUrl || isBusy}
                onClick={handleGenerate}
                className={cn(
                  'group relative w-full overflow-hidden rounded-xl border border-white/10 bg-gradient-to-r from-fuchsia-500 via-violet-500 to-cyan-400 text-white shadow-lg shadow-fuchsia-500/25 transition-all',
                  'hover:shadow-fuchsia-500/40 disabled:cursor-not-allowed disabled:opacity-50',
                )}
              >
                {isBusy ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {stage === 'rate_limited'
                      ? (() => {
                          const mins = Math.floor(rateLimitWait / 60)
                          const secs = rateLimitWait % 60
                          return `Ожидание ${mins}м ${secs.toString().padStart(2, '0')}с…`
                        })()
                      : stage === 'creating'
                        ? 'Подготовка задачи…'
                        : `Генерация… ${pollCount}/${MAX_POLLS}`}
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4" />
                    Сгенерировать видео
                  </span>
                )}
              </Button>

              {/* Upload finished video from Colab */}
              {imageDataUrl && (
                <div className="mt-3">
                  <input
                    type="file"
                    accept="video/*"
                    className="hidden"
                    id="video-upload-input"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) {
                        setUploadedVideoFile(file)
                        toast.success(`Видео выбрано: ${file.name}. Нажмите «Сгенерировать»`)
                      }
                    }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full border-fuchsia-400/30 bg-fuchsia-500/10 text-fuchsia-200 hover:bg-fuchsia-500/20"
                    onClick={() => document.getElementById('video-upload-input')?.click()}
                  >
                    <UploadCloud className="mr-1 h-3 w-3" />
                    {uploadedVideoFile
                      ? `✓ ${uploadedVideoFile.name} — нажмите «Сгенерировать»`
                      : 'Загрузить видео из Colab (generated_video.mp4)'}
                  </Button>
                  {uploadedVideoFile && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-1 w-full text-xs text-white/40 hover:text-white"
                      onClick={() => setUploadedVideoFile(null)}
                    >
                      Отменить выбор видео
                    </Button>
                  )}
                </div>
              )}

              {isBusy && (
                <div className="mt-3">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <motion.div
                      className="h-full rounded-full bg-gradient-to-r from-fuchsia-400 to-cyan-300"
                      animate={{ width: `${progressPct}%` }}
                      transition={{ duration: 0.5 }}
                    />
                  </div>
                  <p className="mt-2 text-center text-xs text-white/40">
                    Нейросеть рисует кадры — обычно это занимает 1–3 минуты.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* RIGHT: result */}
          <Card className="flex flex-col border-white/10 bg-white/[0.03] backdrop-blur-xl">
            <CardContent className="flex flex-1 flex-col p-6">
              <div className="mb-5 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-white/80">
                  <Film className="h-4 w-4 text-cyan-300" />
                  Результат
                </h2>
                {videoUrl && (
                  <div className="flex gap-2">
                    <Button
                      asChild
                      size="sm"
                      variant="outline"
                      className="border-white/15 bg-white/5 hover:bg-white/10"
                    >
                      <a href={videoUrl} download={`video-${Date.now()}.mp4`}>
                        <Download className="mr-1 h-3 w-3" />
                        Скачать
                      </a>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        try {
                          if (navigator.share) {
                            await navigator.share({ title: 'AI Видео', text: settings.prompt || 'Сгенерировано ИИ', url: videoUrl })
                          } else {
                            await navigator.clipboard.writeText(videoUrl)
                            toast.success('Ссылка скопирована!')
                          }
                        } catch { /* ignore */ }
                      }}
                      className="border-white/15 bg-white/5 hover:bg-white/10"
                    >
                      <Share2 className="mr-1 h-3 w-3" />
                      Поделиться
                    </Button>
                  </div>
                )}
              </div>

              <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black/40 min-h-[20rem]">
                <AnimatePresence mode="wait">
                  {stage === 'idle' && !videoUrl && (
                    <motion.div
                      key="idle"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="flex flex-col items-center gap-3 p-8 text-center"
                    >
                      <div className="grid h-16 w-16 place-items-center rounded-2xl bg-white/5 ring-1 ring-white/10">
                        <Film className="h-7 w-7 text-white/30" />
                      </div>
                      <p className="text-sm text-white/40">
                        Здесь появится сгенерированное видео.
                        <br />
                        Загрузите изображение и нажмите «Сгенерировать».
                      </p>
                    </motion.div>
                  )}

                  {(stage === 'creating' || stage === 'polling') && (
                    <motion.div
                      key="busy"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="flex flex-col items-center gap-4 p-8 text-center"
                    >
                      <div className="relative grid h-20 w-20 place-items-center">
                        <div className="absolute inset-0 animate-ping rounded-full bg-fuchsia-500/20" />
                        <div className="grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-fuchsia-500 to-cyan-400">
                          <Loader2 className="h-7 w-7 animate-spin text-white" />
                        </div>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white/80">
                          {stage === 'creating'
                            ? 'Отправляю задачу в нейросеть…'
                            : 'Оживляю изображение…'}
                        </p>
                        <p className="mt-1 text-xs text-white/40">
                          {stage === 'polling' &&
                            `Опрос ${pollCount}/${MAX_POLLS} · ${progressPct}%`}
                        </p>
                      </div>
                    </motion.div>
                  )}

                  {stage === 'rate_limited' && (
                    <motion.div
                      key="rate_limited"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="flex flex-col items-center gap-4 p-8 text-center"
                    >
                      <div className="relative grid h-20 w-20 place-items-center">
                        <div className="absolute inset-0 animate-ping rounded-full bg-amber-500/20" />
                        <div className="grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-amber-500 to-orange-500">
                          <Clock className="h-7 w-7 text-white" />
                        </div>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white/80">
                          Нейросеть ZAI перегружена
                        </p>
                        <p className="mt-1 text-xs text-white/50">
                          Автоматическая попытка через{' '}
                          <span className="font-semibold text-amber-300">
                            {Math.floor(rateLimitWait / 60)}м {(rateLimitWait % 60).toString().padStart(2, '0')}с
                          </span>
                          …
                        </p>
                        <p className="mt-2 text-xs text-white/40">
                          Лимит ZAI: окно откроется. Окно откроется
                          автоматически — оставьте вкладку открытой.
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={cancelGeneration}
                        className="border-white/15 bg-white/5 hover:bg-white/10"
                      >
                        <X className="mr-1 h-3 w-3" />
                        Остановить
                      </Button>
                    </motion.div>
                  )}

                  {stage === 'error' && (
                    <motion.div
                      key="error"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="flex flex-col items-center gap-3 p-8 text-center"
                    >
                      <div className="grid h-14 w-14 place-items-center rounded-full bg-red-500/15 ring-1 ring-red-500/30">
                        <AlertCircle className="h-6 w-6 text-red-300" />
                      </div>
                      <p className="max-w-sm text-sm text-white/70">
                        {errorMsg || 'Произошла ошибка генерации.'}
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleGenerate}
                        className="border-white/15 bg-white/5 hover:bg-white/10"
                      >
                        <RefreshCw className="mr-1 h-3 w-3" />
                        Повторить
                      </Button>
                    </motion.div>
                  )}

                  {stage === 'success' && videoUrl && (
                    <motion.video
                      key={videoUrl}
                      initial={{ opacity: 0, scale: 0.98 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0 }}
                      src={videoUrl}
                      controls
                      autoPlay
                      loop
                      playsInline
                      style={{ filter: VIDEO_FILTERS.find(f => f.id === settings.filter)?.cssFilter || 'none' }}
                      className="max-h-[28rem] w-full object-contain"
                    />
                  )}
                </AnimatePresence>
              </div>

              {/* History */}
              {history.length > 0 && (
                <div className="mt-6">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-white/40">
                      История генераций
                    </h3>
                    <button
                      onClick={clearHistory}
                      className="flex items-center gap-1 text-xs text-white/40 hover:text-white/70"
                    >
                      <Trash2 className="h-3 w-3" />
                      Очистить
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                    {history.map((h) => (
                      <div
                        key={h.id}
                        className="group relative aspect-square overflow-hidden rounded-lg border border-white/10 bg-black/40"
                      >
                        { }
                        <img
                          src={h.thumb || h.imageUrl}
                          alt={h.prompt}
                          className="h-full w-full object-cover transition-transform group-hover:scale-105"
                        />
                        <a
                          href={h.videoUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 transition-opacity group-hover:opacity-100"
                        >
                          <span className="grid h-9 w-9 place-items-center rounded-full bg-white/20 backdrop-blur">
                            <Film className="h-4 w-4" />
                          </span>
                        </a>
                        <button
                          onClick={() => removeHistoryItem(h.id)}
                          className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white/70 opacity-0 transition-opacity hover:text-white group-hover:opacity-100"
                          aria-label="Удалить из истории"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {stage === 'success' && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={resetAll}
                  className="mt-4 self-center text-white/60 hover:text-white"
                >
                  <RefreshCw className="mr-1 h-3 w-3" />
                  Начать заново
                </Button>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Footer note */}
        <p className="mt-10 text-center text-xs text-white/30">
          Сгенерировано через Z.ai · видео хранятся на сервере ограниченное время,
          скачайте результат сразу.
        </p>
      </main>
    </div>
  )
}
