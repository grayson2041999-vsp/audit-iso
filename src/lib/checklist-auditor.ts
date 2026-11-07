import { and, asc, eq } from 'drizzle-orm';
import { db } from './db';
import { assignments, auditMembers } from './schema';

/**
 * Tên ghi trên checklist: đánh giá viên tự soạn thì là chính họ; trưởng đoàn
 * soạn thì là những đánh giá viên được phân công cho đơn vị đó (chưa phân công
 * ai thì là trưởng đoàn).
 */
export async function checklistAuditorName(
  actor: { kind: 'member' | 'leader'; name: string },
  auditId: string,
  unitId: string,
) {
  if (actor.kind === 'member') return actor.name;
  const rows = await db
    .select({ name: auditMembers.fullName })
    .from(assignments)
    .innerJoin(auditMembers, eq(assignments.memberId, auditMembers.id))
    .where(and(eq(assignments.auditId, auditId), eq(assignments.unitId, unitId)))
    .orderBy(asc(auditMembers.createdAt));
  return rows.length > 0 ? rows.map((r) => r.name).join(', ') : actor.name;
}
