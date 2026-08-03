import { NextResponse } from 'next/server';
import { endMemberSession } from '@/lib/member-auth';

export const runtime = 'nodejs';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await endMemberSession(id);
  return NextResponse.json({ ok: true });
}
