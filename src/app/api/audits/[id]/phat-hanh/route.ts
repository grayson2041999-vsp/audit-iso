import { NextResponse } from 'next/server';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import {
  auditEvents, auditUnits, audits, correctiveItems, correctiveReports, findings,
  reportReleases, type ReleasedFinding,
} from '@/lib/schema';
import { getOwnedAudit } from '@/lib/audit-access';
import { generateUnitCode, needsCapa } from '@/lib/capa';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  /** Bắt buộc từ bản 2 trở đi. Kiểm ở dưới vì bản 1 không cần. */
  reason: z.string().trim().optional(),
});

/**
 * Phát hành báo cáo cho các đơn vị được đánh giá.
 *
 * Gọi lần đầu = gửi bản 1. Gọi lại = phát hành bản 2, 3… mỗi bản một dòng
 * trong `report_releases` kèm lý do bắt buộc.
 *
 * BA VIỆC TRONG MỘT LẦN BẤM:
 *
 *  1. CHỤP ẢNH BÁO CÁO. Đơn vị đọc ảnh chụp này, không đọc dữ liệu sống — nên
 *     trưởng đoàn có mở đợt ra sửa gì thì bên kia vẫn thấy đúng bản đã gửi cho
 *     tới khi phát hành bản mới. Đây là cách hoà giữa "đã gửi thì không được
 *     sửa lén" và "vẫn phải sửa được lỗi chính tả".
 *
 *  2. CẤP MÃ 8 SỐ cho từng đơn vị. Chỉ cấp cho đơn vị chưa có — phát hành lại
 *     KHÔNG đổi mã, nếu không thì mỗi lần sửa một dấu phẩy là phải đi báo mã
 *     mới cho cả chục đơn vị.
 *
 *  3. DỰNG GÓI KHẮC PHỤC cho đơn vị nào có sự không phù hợp. Đơn vị chỉ có
 *     OBS/OFI thì không tạo gói — họ vẫn xem được báo cáo, chỉ là không phải
 *     làm hồ sơ gì.
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;

  const owned = await getOwnedAudit(id);
  if (!owned) return NextResponse.json({ error: 'Không có quyền.' }, { status: 403 });

  /**
   * Bắt buộc khoá đợt trước khi gửi. Gửi một báo cáo mà đánh giá viên còn đang
   * nhập dở là gửi một thứ chưa xong.
   */
  if (owned.audit.status !== 'CLOSED') {
    return NextResponse.json(
      { error: 'Phải khoá đợt trước khi gửi báo cáo cho đơn vị.' },
      { status: 409 },
    );
  }

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dữ liệu không hợp lệ.' }, { status: 400 });
  }

  const nextVersion = owned.audit.reportVersion + 1;
  const reason = parsed.data.reason?.trim() ?? '';

  if (nextVersion > 1 && reason.length < 5) {
    return NextResponse.json(
      { error: 'Phát hành lại phải nêu lý do — đơn vị sẽ nhìn thấy lý do này.' },
      { status: 400 },
    );
  }

  try {
    const [units, rows] = await Promise.all([
      db.select().from(auditUnits).where(eq(auditUnits.auditId, id)).orderBy(asc(auditUnits.name)),
      db.select().from(findings).where(eq(findings.auditId, id)).orderBy(asc(findings.code)),
    ]);

    if (units.length === 0) {
      return NextResponse.json({ error: 'Đợt chưa có đơn vị nào.' }, { status: 400 });
    }
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Đợt chưa có finding nào để gửi.' }, { status: 400 });
    }

    const unitName = new Map(units.map((u) => [u.id, u.name]));

    /* --- 1. Ảnh chụp báo cáo --- */
    const snapshot: ReleasedFinding[] = rows.map((f) => ({
      id: f.id,
      code: f.code,
      unitId: f.unitId,
      // Ưu tiên tên đơn vị hiện tại, rơi về bản chụp tên lúc ghi nhận nếu đơn
      // vị đã bị xoá khỏi đợt.
      unitName: (f.unitId && unitName.get(f.unitId)) || f.auditee || null,
      severity: f.severity,
      title: f.title,
      statement: f.statement,
      evidence: f.evidence,
      clauses: f.clauses,
      rawArea: f.rawArea,
      auditorName: f.auditorName,
      dueDate: f.dueDate ? f.dueDate.toISOString() : null,
      observedAt: f.observedAt ? f.observedAt.toISOString() : null,
    }));

    await db.insert(reportReleases).values({
      auditId: id,
      version: nextVersion,
      reason: reason || null,
      releasedBy: owned.leader.fullName,
      snapshot,
    });

    /* --- 2. Cấp mã cho đơn vị chưa có --- */
    const taken = new Set(units.map((u) => u.accessCode).filter(Boolean) as string[]);
    for (const u of units) {
      if (u.accessCode) continue;
      await db
        .update(auditUnits)
        .set({ accessCode: generateUnitCode(taken) })
        .where(eq(auditUnits.id, u.id));
    }

    /* --- 3. Dựng / cập nhật gói khắc phục --- */
    const ncByUnit = new Map<string, string[]>();
    for (const f of rows) {
      if (!f.unitId || !needsCapa(f.severity)) continue;
      const list = ncByUnit.get(f.unitId) ?? [];
      list.push(f.id);
      ncByUnit.set(f.unitId, list);
    }

    const existing = await db
      .select()
      .from(correctiveReports)
      .where(eq(correctiveReports.auditId, id));
    const reportByUnit = new Map(existing.map((r) => [r.unitId, r]));

    for (const [unitId, findingIds] of ncByUnit) {
      let report = reportByUnit.get(unitId);

      if (!report) {
        [report] = await db
          .insert(correctiveReports)
          .values({ auditId: id, unitId })
          .returning();
      }

      /**
       * Đồng bộ danh sách mục với danh sách NC của bản vừa phát hành.
       *
       * Bản mới có thể thêm NC, hoặc hạ một NC xuống Observation. Mục không còn
       * là NC thì TẮT chứ không xoá — đơn vị có thể đã gõ phân tích nguyên nhân
       * vào đó, xoá đi là mất công của họ và mất cả dấu vết.
       */
      const items = await db
        .select()
        .from(correctiveItems)
        .where(eq(correctiveItems.reportId, report.id));
      const itemByFinding = new Map(items.map((it) => [it.findingId, it]));

      for (const fid of findingIds) {
        const it = itemByFinding.get(fid);
        if (!it) {
          await db.insert(correctiveItems).values({ reportId: report.id, findingId: fid });
        } else if (!it.isActive) {
          await db
            .update(correctiveItems)
            .set({ isActive: true, updatedAt: new Date() })
            .where(eq(correctiveItems.id, it.id));
        }
      }

      const stale = items.filter((it) => it.isActive && !findingIds.includes(it.findingId));
      if (stale.length > 0) {
        await db
          .update(correctiveItems)
          .set({ isActive: false, updatedAt: new Date() })
          .where(inArray(correctiveItems.id, stale.map((it) => it.id)));
      }
    }

    /**
     * Đơn vị không còn NC nào sau khi phát hành lại: tắt hết mục, giữ lại gói.
     * Không xoá gói — lịch sử nộp / duyệt của họ phải còn.
     */
    for (const r of existing) {
      if (ncByUnit.has(r.unitId)) continue;
      await db
        .update(correctiveItems)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(correctiveItems.reportId, r.id), eq(correctiveItems.isActive, true)));
    }

    /* --- Chốt --- */
    await db
      .update(audits)
      .set({
        issuedAt: owned.audit.issuedAt ?? new Date(),
        reportVersion: nextVersion,
        updatedAt: new Date(),
      })
      .where(eq(audits.id, id));

    await db.insert(auditEvents).values({
      auditId: id,
      actor: owned.leader.fullName,
      action: nextVersion === 1 ? 'RELEASE_V1' : `RELEASE_V${nextVersion}`,
      note: reason || null,
    });

    return NextResponse.json({
      ok: true,
      version: nextVersion,
      units: units.length,
      unitsWithNc: ncByUnit.size,
      findings: snapshot.length,
    });
  } catch (e) {
    console.error('[phat-hanh]', e);
    return NextResponse.json({ error: 'Không phát hành được báo cáo.' }, { status: 500 });
  }
}

/**
 * Thu hồi toàn bộ việc phát hành. Dùng khi bấm nhầm.
 *
 * Xoá `issued_at` là mọi phiên đơn vị hết hiệu lực ngay lập tức (xem
 * `unit-auth.ts`) — không phải đi thu hồi từng cookie. Giữ nguyên mã, các bản
 * đã phát hành và hồ sơ khắc phục: thu hồi là sửa một cú bấm nhầm, không phải
 * xoá lịch sử.
 *
 * Chỉ cho thu hồi khi CHƯA đơn vị nào nộp gì — nộp rồi mà rút lại thì công của
 * họ treo lơ lửng.
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;

  const owned = await getOwnedAudit(id);
  if (!owned) return NextResponse.json({ error: 'Không có quyền.' }, { status: 403 });
  if (!owned.audit.issuedAt) {
    return NextResponse.json({ error: 'Đợt chưa phát hành.' }, { status: 409 });
  }

  try {
    const [{ submitted }] = await db
      .select({ submitted: sql<number>`count(*)::int` })
      .from(correctiveReports)
      .where(
        and(
          eq(correctiveReports.auditId, id),
          sql`${correctiveReports.status} <> 'PLAN_DRAFT'`,
        ),
      );

    if (submitted > 0) {
      return NextResponse.json(
        { error: `Đã có ${submitted} đơn vị nộp hồ sơ, không thu hồi được nữa.` },
        { status: 409 },
      );
    }

    await db.update(audits).set({ issuedAt: null, updatedAt: new Date() }).where(eq(audits.id, id));

    await db.insert(auditEvents).values({
      auditId: id,
      actor: owned.leader.fullName,
      action: 'RELEASE_REVOKED',
      note: 'Thu hồi phát hành, đơn vị không truy cập được nữa.',
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[phat-hanh:DELETE]', e);
    return NextResponse.json({ error: 'Không thu hồi được.' }, { status: 500 });
  }
}
