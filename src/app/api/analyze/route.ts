import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'

export const runtime = 'nodejs'
export const maxDuration = 30

/**
 * Analyze image using ZAI Vision API and generate a detailed video prompt.
 * This helps ZAI cogvideox-3 understand what transformation to animate.
 *
 * Example: user uploads a car photo + prompt "transform into robot"
 * → Vision analyzes: "a red sports car parked on a street"
 * → Generated prompt: "a red sports car parked on a street, the car begins
 *   to transform, metal panels shift and fold, mechanical arms extend,
 *   the car morphs into a giant robot standing upright, cinematic transformation"
 */

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { imageUrl, userPrompt } = body as { imageUrl: string; userPrompt?: string }

    if (!imageUrl) {
      return NextResponse.json({ error: 'Изображение обязательно' }, { status: 400 })
    }

    const zai = await ZAI.create()

    // Use ZAI Vision to analyze the image and generate a detailed video prompt
    const systemPrompt = `Ты — эксперт по созданию промптов для AI видео-генерации.
Проанализируй изображение и создай детальный промпт на АНГЛИЙСКОМ ЯЗЫКЕ для генерации видео.

Правила:
1. Опиши, что видишь на изображении (объекты, цвета, фон, освещение)
2. Если пользователь хочет трансформацию — опиши её ПОШАГОВО, плавно
3. Промпт должен быть кинематографичным: движение камеры, освещение, атмосфера
4. Не более 100 слов
5. Фокус на плавном движении и трансформации`

    const userMessage = `Опиши изображение и создай промпт для видео.
Пожелание пользователя: ${userPrompt || 'просто оживи сцену'}`

    const completion = await zai.chat.completions.createVision({
      model: 'glm-4v',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: `${systemPrompt}\n\n${userMessage}` },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        },
      ],
      thinking: { type: 'disabled' },
    })

    const enhancedPrompt = completion.choices[0]?.message?.content || userPrompt || ''

    return NextResponse.json({
      enhancedPrompt,
      originalPrompt: userPrompt || '',
    })
  } catch (err) {
    console.error('[analyze] error:', err)
    const message = err instanceof Error ? err.message : 'Analysis failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
