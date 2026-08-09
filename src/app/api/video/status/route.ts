import { NextRequest, NextResponse } from 'next/server'
import { queryVideoStatus } from '@/lib/zai'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  try {
    const taskId = req.nextUrl.searchParams.get('taskId')
    if (!taskId) {
      return NextResponse.json(
        { error: 'Параметр taskId обязателен.' },
        { status: 400 },
      )
    }
    const result = await queryVideoStatus(taskId)
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Не удалось получить статус задачи'
    console.error('[video/status] error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
