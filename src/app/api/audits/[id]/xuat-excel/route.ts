import { NextResponse } from 'next/server';
import { and, asc, eq, inArray, type SQL } from 'drizzle-orm';
import { db } from '@/lib/db';
import { auditMembers, auditUnits, findingImages, findings } from '@/lib/schema';
import { getOwnedAudit } from '@/lib/audit-access';
import { getObjectBytes, isR2Configured } from '@/lib/r2';
import { buildFindingsWorkbook, MAX_PHOTOS } from '@/lib/findings-xlsx';

export const runtime = 'nodejs';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/** Số ảnh tải song song từ R2 — đủ nhanh mà không dồn cả trăm request một lúc. */
const PHOTO_CONCURRENCY = 6;

/**
 * Tải ảnh của các finding để chèn vào file (tối đa MAX_PHOTOS mỗi finding).
 *
 * Ảnh nào tải lỗi thì bỏ qua — thiếu một tấm ảnh không được làm hỏng cả file
 * xuất. R2 chưa cấu hình thì xuất file không ảnh như trước.
 */
async function loadPhotos(findingIds: string[]) {
  const photos = new Map<string, Buffer[]>();
  const photoCounts = new Map<string, number>();
  if (!findingIds.length || !isR2Configured()) return { photos, photoCounts };

  const imgs = await db
    .select({ findingId: findingImages.findingId, key: findingImages.key })
    .from(findingImages)
    .where(inArray(findingImages.findingId, findingIds))
    // Cùng thứ tự lúc auditor tải lên.
    .orderBy(asc(findingImages.createdAt), asc(findingImages.id));

  const jobs: { findingId: string; key: string; slot: number }[] = [];
  for (const img of imgs) {
    const n = photoCounts.get(img.findingId) ?? 0;
    photoCounts.set(img.findingId, n + 1);
    if (n < MAX_PHOTOS) jobs.push({ ...img, slot: n });
  }

  const loaded = new Map<string, (Buffer | null)[]>();
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const job = jobs[next++];
      let bytes: Buffer | null = null;
      try {
        bytes = (await getObjectBytes(job.key)).bytes;
      } catch (e) {
        console.error('[xuat-excel] Không tải được ảnh:', job.key, e);
      }
      const arr = loaded.get(job.findingId) ?? [];
      arr[job.slot] = bytes;
      loaded.set(job.findingId, arr);
    }
  }
  await Promise.all(Array.from({ length: PHOTO_CONCURRENCY }, worker));

  for (const [fid, arr] of loaded) {
    photos.set(fid, arr.filter((b): b is Buffer => b != null));
  }
  return { photos, photoCounts };
}

/**
 * Xuất bảng tổng hợp ra .xlsx.
 * Bộ lọc đang bật trên màn hình được truyền qua tham số URL nên file tải về
 * khớp đúng những gì trưởng đoàn đang nhìn thấy.
 */
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;

  const owned = await getOwnedAudit(id);
  if (!owned) return NextResponse.json({ error: 'Không có quyền.' }, { status: 403 });
  const { audit } = owned;

  const sp = new URL(req.url).searchParams;
  const conds: SQL[] = [eq(findings.auditId, id)];
  if (sp.get('unit')) conds.push(eq(findings.unitId, sp.get('unit')!));
  if (sp.get('member')) conds.push(eq(findings.memberId, sp.get('member')!));
  if (sp.get('severity')) conds.push(eq(findings.severity, sp.get('severity') as never));
  if (sp.get('status')) conds.push(eq(findings.status, sp.get('status') as never));

  const [rows, units, members] = await Promise.all([
    db.select().from(findings).where(and(...conds)).orderBy(asc(findings.code)),
    db.select().from(auditUnits).where(eq(auditUnits.auditId, id)).orderBy(asc(auditUnits.name)),
    db.select().from(auditMembers).where(eq(auditMembers.auditId, id)),
  ]);

  const { photos, photoCounts } = await loadPhotos(rows.map((f) => f.id));

  const wb = await buildFindingsWorkbook({ audit, rows, units, members, photos, photoCounts });

  /* ---------------- Trả file ---------------- */

  const buffer = await wb.xlsx.writeBuffer();
  // Không còn mã đợt — đặt tên file theo tên tổ chức, bỏ dấu để tải về không lỗi.
  const slug = audit.organization
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^\w]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  const fileName = `${slug || 'tong-hop'}_finding.xlsx`;

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store',
    },
  });
}
