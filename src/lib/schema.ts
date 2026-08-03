import {
  pgTable, text, timestamp, uuid, integer, jsonb, pgEnum, index, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

/* ------------------------------------------------------------------ */
/* Enums                                                               */
/* ------------------------------------------------------------------ */

export const severityEnum = pgEnum('severity', [
  'MAJOR', // Sự không phù hợp nặng
  'MINOR', // Sự không phù hợp nhẹ
  'OBS',   // Quan sát / lưu ý
  'OFI',   // Cơ hội cải tiến
  'CONF',  // Phù hợp
]);

export const findingStatusEnum = pgEnum('finding_status', [
  'DRAFT',      // Auditor mới nhập, chưa chuẩn hoá
  'AI_DRAFTED', // AI đã chuẩn hoá, chờ auditor duyệt
  'REVIEWED',   // Auditor đã duyệt/chỉnh
  'ISSUED',     // Đã phát hành vào báo cáo
  'CLOSED',     // Đã đóng sau hành động khắc phục
]);

/**
 * Trạng thái đợt đánh giá — suy ra từ hành động, không có nút bật/tắt riêng:
 *   PLANNED     "Đang chuẩn bị"   — chưa sinh mã cho đánh giá viên
 *   IN_PROGRESS "Đang thực hiện"  — đã sinh mã, đánh giá viên vào nhập được
 *   CLOSED      "Đã khoá"         — trưởng đoàn khoá, chỉ xem
 * (REPORTING giữ trong enum vì Postgres không xoá được giá trị enum, nhưng không dùng.)
 */
export const auditStatusEnum = pgEnum('audit_status', [
  'PLANNED', 'IN_PROGRESS', 'REPORTING', 'CLOSED',
]);

/* ------------------------------------------------------------------ */
/* leaders — tài khoản trưởng đoàn đánh giá                            */
/* ------------------------------------------------------------------ */

export const leaders = pgTable('leaders', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  fullName: text('full_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/* ------------------------------------------------------------------ */
/* audits — mỗi đợt đánh giá nội bộ                                    */
/* ------------------------------------------------------------------ */

export const audits = pgTable('audits', {
  id: uuid('id').primaryKey().defaultRandom(),
  leaderId: uuid('leader_id')
    .references(() => leaders.id, { onDelete: 'cascade' })
    .notNull(),
  code: text('code').notNull(),                  // VD: IA-2026-07
  title: text('title').notNull(),
  scope: text('scope'),                          // Phạm vi đánh giá
  standards: jsonb('standards').$type<string[]>().default([]).notNull(),
  leadAuditor: text('lead_auditor'),             // Tên trưởng đoàn ghi trên báo cáo
  startDate: timestamp('start_date', { withTimezone: true }),
  endDate: timestamp('end_date', { withTimezone: true }),
  status: auditStatusEnum('status').default('PLANNED').notNull(),
  /**
   * Bộ đếm sinh mã finding (F-01, F-02…). Mỗi lần lưu finding chạy
   * `UPDATE audits SET finding_seq = finding_seq + 1 ... RETURNING finding_seq`
   * — thao tác nguyên tử, hai người lưu cùng lúc không bao giờ nhận trùng số.
   */
  findingSeq: integer('finding_seq').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/* ------------------------------------------------------------------ */
/* audit_units — đơn vị được đánh giá, khai báo riêng theo từng đợt     */
/* ------------------------------------------------------------------ */

export const auditUnits = pgTable(
  'audit_units',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    auditId: uuid('audit_id')
      .references(() => audits.id, { onDelete: 'cascade' })
      .notNull(),
    name: text('name').notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ auditIdx: index('audit_units_audit_idx').on(t.auditId) }),
);

/* ------------------------------------------------------------------ */
/* audit_members — đánh giá viên của đợt                                */
/* ------------------------------------------------------------------ */

export const auditMembers = pgTable(
  'audit_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    auditId: uuid('audit_id')
      .references(() => audits.id, { onDelete: 'cascade' })
      .notNull(),
    fullName: text('full_name').notNull(),
    /** Đơn vị công tác — dùng để cảnh báo khi phân công vào chính đơn vị mình. */
    homeUnit: text('home_unit'),
    /** Mã 6 số, chỉ có sau khi trưởng đoàn bấm "Sinh mã & mở đợt". */
    accessCode: text('access_code'),
    /** Trưởng đoàn tự thêm mình vào đoàn để cũng đi đánh giá. */
    isLeader: text('is_leader').default('0').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ auditIdx: index('audit_members_audit_idx').on(t.auditId) }),
);

/* ------------------------------------------------------------------ */
/* assignments — phân công nhiều–nhiều giữa đánh giá viên và đơn vị     */
/* ------------------------------------------------------------------ */

export const assignments = pgTable(
  'assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    auditId: uuid('audit_id')
      .references(() => audits.id, { onDelete: 'cascade' })
      .notNull(),
    memberId: uuid('member_id')
      .references(() => auditMembers.id, { onDelete: 'cascade' })
      .notNull(),
    unitId: uuid('unit_id')
      .references(() => auditUnits.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    auditIdx: index('assignments_audit_idx').on(t.auditId),
    pairIdx: uniqueIndex('assignments_pair_idx').on(t.memberId, t.unitId),
  }),
);

/* ------------------------------------------------------------------ */
/* findings                                                            */
/* ------------------------------------------------------------------ */

export const findings = pgTable(
  'findings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    auditId: uuid('audit_id').references(() => audits.id, { onDelete: 'set null' }),

    code: text('code'),                          // NC-001
    status: findingStatusEnum('status').default('DRAFT').notNull(),

    /* --- Input thô của auditor --- */
    rawText: text('raw_text').notNull(),
    rawArea: text('raw_area'),                   // Nơi phát hiện (khu vực / bộ phận)
    rawProcess: text('raw_process'),             // Quá trình liên quan
    auditee: text('auditee'),                    // Đơn vị được đánh giá
    auditorName: text('auditor_name'),
    observedAt: timestamp('observed_at', { withTimezone: true }),
    dueDate: timestamp('due_date', { withTimezone: true }), // Thời hạn khắc phục
    standards: jsonb('standards').$type<string[]>().default([]).notNull(),

    /* --- Kết quả AI chuẩn hoá --- */
    title: text('title'),
    severity: severityEnum('severity'),
    evidence: jsonb('evidence').$type<string[]>().default([]).notNull(), // Bằng chứng khách quan
    statement: text('statement'),                // Phát biểu finding hoàn chỉnh (đủ R–N–E)
    clauses: jsonb('clauses')
      .$type<{ standard: string; clause: string; clauseTitle: string }[]>()
      .default([])
      .notNull(),
    missingInfo: jsonb('missing_info').$type<string[]>().default([]).notNull(),
    aiModel: text('ai_model'),
    aiRaw: jsonb('ai_raw'),                      // Toàn bộ JSON gốc từ AI

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    auditIdx: index('findings_audit_idx').on(t.auditId),
    statusIdx: index('findings_status_idx').on(t.status),
    createdIdx: index('findings_created_idx').on(t.createdAt),
  }),
);

/* ------------------------------------------------------------------ */
/* finding_images — ảnh lưu trên Cloudflare R2                         */
/* ------------------------------------------------------------------ */

export const findingImages = pgTable(
  'finding_images',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    findingId: uuid('finding_id')
      .references(() => findings.id, { onDelete: 'cascade' })
      .notNull(),
    key: text('key').notNull(),                  // object key trong bucket R2
    fileName: text('file_name'),
    contentType: text('content_type'),
    size: integer('size'),
    caption: text('caption'),                    // Mô tả ảnh do AI sinh
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ findingIdx: index('finding_images_finding_idx').on(t.findingId) }),
);

/* ------------------------------------------------------------------ */
/* finding_revisions — lịch sử chỉnh sửa                               */
/* ------------------------------------------------------------------ */

export const findingRevisions = pgTable('finding_revisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  findingId: uuid('finding_id')
    .references(() => findings.id, { onDelete: 'cascade' })
    .notNull(),
  editor: text('editor'),
  note: text('note'),
  snapshot: jsonb('snapshot').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/* ------------------------------------------------------------------ */
/* Relations                                                           */
/* ------------------------------------------------------------------ */

export const leadersRelations = relations(leaders, ({ many }) => ({
  audits: many(audits),
}));

export const auditsRelations = relations(audits, ({ one, many }) => ({
  leader: one(leaders, { fields: [audits.leaderId], references: [leaders.id] }),
  units: many(auditUnits),
  members: many(auditMembers),
  assignments: many(assignments),
  findings: many(findings),
}));

export const auditUnitsRelations = relations(auditUnits, ({ one, many }) => ({
  audit: one(audits, { fields: [auditUnits.auditId], references: [audits.id] }),
  assignments: many(assignments),
}));

export const auditMembersRelations = relations(auditMembers, ({ one, many }) => ({
  audit: one(audits, { fields: [auditMembers.auditId], references: [audits.id] }),
  assignments: many(assignments),
}));

export const assignmentsRelations = relations(assignments, ({ one }) => ({
  audit: one(audits, { fields: [assignments.auditId], references: [audits.id] }),
  member: one(auditMembers, { fields: [assignments.memberId], references: [auditMembers.id] }),
  unit: one(auditUnits, { fields: [assignments.unitId], references: [auditUnits.id] }),
}));

export const findingsRelations = relations(findings, ({ one, many }) => ({
  audit: one(audits, { fields: [findings.auditId], references: [audits.id] }),
  images: many(findingImages),
  revisions: many(findingRevisions),
}));

export const findingImagesRelations = relations(findingImages, ({ one }) => ({
  finding: one(findings, { fields: [findingImages.findingId], references: [findings.id] }),
}));

export const findingRevisionsRelations = relations(findingRevisions, ({ one }) => ({
  finding: one(findings, { fields: [findingRevisions.findingId], references: [findings.id] }),
}));

export type Leader = typeof leaders.$inferSelect;
export type Audit = typeof audits.$inferSelect;
export type AuditUnit = typeof auditUnits.$inferSelect;
export type AuditMember = typeof auditMembers.$inferSelect;
export type Assignment = typeof assignments.$inferSelect;
export type Finding = typeof findings.$inferSelect;
export type FindingImage = typeof findingImages.$inferSelect;
