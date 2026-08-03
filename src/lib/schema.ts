import {
  pgTable, text, timestamp, uuid, integer, jsonb, pgEnum, index,
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

export const auditStatusEnum = pgEnum('audit_status', [
  'PLANNED', 'IN_PROGRESS', 'REPORTING', 'CLOSED',
]);

/* ------------------------------------------------------------------ */
/* audits — mỗi cuộc đánh giá nội bộ                                   */
/* ------------------------------------------------------------------ */

export const audits = pgTable('audits', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull(),                  // VD: IA-2026-07
  title: text('title').notNull(),
  scope: text('scope'),                          // Phạm vi đánh giá
  standards: jsonb('standards').$type<string[]>().default([]).notNull(),
  auditee: text('auditee'),                      // Đơn vị được đánh giá
  leadAuditor: text('lead_auditor'),
  startDate: timestamp('start_date', { withTimezone: true }),
  endDate: timestamp('end_date', { withTimezone: true }),
  status: auditStatusEnum('status').default('IN_PROGRESS').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

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
    requirement: text('requirement'),            // Yêu cầu (R)
    nonconformity: text('nonconformity'),        // Sự không phù hợp (N)
    evidence: jsonb('evidence').$type<string[]>().default([]).notNull(), // Bằng chứng (E)
    statement: text('statement'),                // Phát biểu finding hoàn chỉnh
    clauses: jsonb('clauses')
      .$type<{ standard: string; clause: string; clauseTitle: string }[]>()
      .default([])
      .notNull(),
    riskAnalysis: text('risk_analysis'),
    suggestedAction: text('suggested_action'),
    missingInfo: jsonb('missing_info').$type<string[]>().default([]).notNull(),
    confidence: integer('confidence'),           // 0-100
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

export const auditsRelations = relations(audits, ({ many }) => ({
  findings: many(findings),
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

export type Audit = typeof audits.$inferSelect;
export type Finding = typeof findings.$inferSelect;
export type FindingImage = typeof findingImages.$inferSelect;
