# 🎬 AI Video Generator

**Бесплатный генератор видео из изображения на базе ИИ** — без подписок, без лимитов, без API ключей.

![License](https://img.shields.io/badge/license-MIT-blue)
![Next.js](https://img.shields.io/badge/Next.js-16-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)

## ✨ Возможности

- 🖼️ **Image-to-Video** — превратите статичное изображение в видео
- 🤖 **Настоящий ИИ** — Stable Video Diffusion (SVD) через Google Colab (бесплатный GPU)
- 🎨 **AI Frames** — генерация через Pollinations (Flux/Stable Diffusion, без ключей)
- ⚡ **Локальный движок** — эффект Ken Burns через ffmpeg (мгновенно)
- 🔄 **Мульти-провайдер** — автоматический fallback между источниками
- 🎛️ **Настройки** — длительность, FPS, интенсивность движения, качество
- 📥 **История** — сохранение последних генераций
- 🌗 **Тёмная тема** — красивый UI с анимациями

## 🚀 Быстрый старт

### Вариант 1: Локальный запуск

```bash
# Клонировать репозиторий
git clone https://github.com/gpr812-lgtm/ai-video-generator.git
cd ai-video-generator

# Установить зависимости
npm install  # или: bun install

# Запустить
npm run dev  # или: bun run dev
```

Откройте http://localhost:3000

### Вариант 2: Лучшее качество (Google Colab, бесплатно)

1. Откройте [Google Colab](https://colab.research.google.com)
2. Создайте новый notebook
3. Скопируйте код из `colab/notebook.py`
4. Runtime → Change runtime type → **T4 GPU**
5. Запустите ячейку (Shift+Enter)
6. Загрузите изображение → получите видео (SVD, ~30 сек)
7. Загрузите видео в приложение через кнопку "Загрузить видео из Colab"

## 🎯 Провайдеры

| Провайдер | Тип | Бесплатно | Качество | Скорость |
|-----------|-----|-----------|----------|----------|
| **Google Colab (SVD)** | Video Diffusion | ✅ (12ч/день GPU) | ⭐⭐⭐⭐⭐ | ~30 сек |
| **AI Frames (Pollinations)** | Image Generation | ✅ (без лимитов) | ⭐⭐⭐ | ~50 сек |
| **Local ffmpeg** | Ken Burns Effect | ✅ (мгновенно) | ⭐⭐ | ~2 сек |
| **ZAI (cogvideox-3)** | Video Diffusion | ✅ (1 req/10 мин) | ⭐⭐⭐⭐ | ~2 мин |
| **Replicate (SVD)** | Video Diffusion | $1 при регистрации | ⭐⭐⭐⭐⭐ | ~60 сек |
| **Segmind (SVD)** | Video Diffusion | 100 вызовов | ⭐⭐⭐⭐⭐ | ~30 сек |

## 📁 Структура проекта

```
ai-video-generator/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── api/
│   │   │   ├── generate/       # Multi-provider endpoint
│   │   │   ├── video/          # ZAI video generation
│   │   │   ├── providers/      # Provider management
│   │   │   ├── colab/          # Colab integration
│   │   │   └── keys/           # API key management
│   │   └── page.tsx
│   ├── components/
│   │   └── image-to-video-app.tsx  # Main UI
│   └── lib/
│       ├── providers.ts        # Multi-provider logic
│       ├── colab.ts            # Colab integration
│       ├── ai-frames.ts        # Pollinations AI
│       ├── local-video.ts      # ffmpeg Ken Burns
│       └── zai.ts              # ZAI integration
├── colab/
│   └── notebook.py             # SVD notebook for Colab
├── public/
└── package.json
```

## 🛠️ Технологии

- **Next.js 16** — React фреймворк
- **TypeScript 5** — типизация
- **Tailwind CSS 4** — стили
- **shadcn/ui** — компоненты
- **Framer Motion** — анимации
- **Stable Video Diffusion** — AI модель (через Colab)
- **Pollinations.ai** — бесплатная генерация изображений
- **ffmpeg** — обработка видео

## 📝 Лицензия

MIT License — используйте свободно.

## 🤝 Вклад

Pull requests приветствуются!
