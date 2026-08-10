import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'

export const runtime = 'nodejs'
export const maxDuration = 20 // Short — gateway times out at ~30s

/**
 * Analyze image using ZAI Vision API and generate a SHORT video prompt.
 * Returns a prompt under 500 chars (ZAI cogvideox-3 limit).
 */

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { imageUrl, userPrompt } = body as { imageUrl: string; userPrompt?: string }

    if (!imageUrl) {
      return NextResponse.json({ error: 'Изображение обязательно' }, { status: 400 })
    }

    const zai = await ZAI.create()

    // Short, focused system prompt — generates SHORT output
    const systemPrompt = `Analyze the image and create a SHORT video generation prompt in English (max 80 words).
Rules:
- Describe what you see (objects, colors, scene)
- If user wants transformation, describe it step-by-step
- Include camera movement and lighting
- Be concise and cinematic
- Output ONLY the prompt, no explanations`

    const userMessage = `User request: ${userPrompt || 'animate this scene'}`

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

    let enhancedPrompt = completion.choices[0]?.message?.content || userPrompt || ''

    // Clean up: remove markdown, headers, extra whitespace
    enhancedPrompt = enhancedPrompt
      .replace(/^#+\s*/gm, '') // remove markdown headers
      .replace(/^\*\*.*\*\*:?\s*/gm, '') // remove bold headers
      .replace(/^>\s*/gm, '') // remove blockquotes
      .replace(/\n{3,}/g, '\n\n') // collapse multiple newlines
      .trim()

    // Truncate to 500 chars (ZAI cogvideox-3 limit)
    if (enhancedPrompt.length > 500) {
      enhancedPrompt = enhancedPrompt.slice(0, 497) + '...'
    }

    return NextResponse.json({
      enhancedPrompt,
      originalPrompt: userPrompt || '',
    })
  } catch (err) {
    console.error('[analyze] error:', err)
    // Return original prompt instead of failing
    const body = await req.json().catch(() => ({}))
    return NextResponse.json({
      enhancedPrompt: body.userPrompt || '',
      originalPrompt: body.userPrompt || '',
      error: 'Анализ недоступен, используется оригинальный промпт',
    })
  }
}
