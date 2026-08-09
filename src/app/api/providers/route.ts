import { NextResponse } from 'next/server'
import { listProviders } from '@/lib/providers'

export const runtime = 'nodejs'

/**
 * GET /api/providers — list all available video generation providers
 */
export async function GET() {
  return NextResponse.json({
    providers: listProviders(),
  })
}
