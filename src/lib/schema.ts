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

/**
 * Vòng đời finding:
 *   DRAFT     — đánh giá viên đang soạn, tự sửa và xoá được
 *   SUBMITTED — đã nộp, đánh giá viên hết quyền sửa, chỉ trưởng đoàn sửa
 *   REVIEWED  — trưởng đoàn đã rà soát
 *   CLOSED    — đã đóng sau hành động khắc phục
 * (AI_DRAFTED và ISSUED giữ trong enum vì Postgres không xoá được giá trị
 *  enum, nhưng không còn dùng.)
 */
export const findingStatusEnum = pgEnum('finding_status', [
  'DRAFT',
  'AI_DRAFTED',
  'REVIEWED',
  'ISSUED',
  'CLOSED',
  'SUBMITTED',
]);

/**
 * Loại phiên trong chương trình đánh giá.
 *   OPENING  — họp khai mạc
 *   UNIT     — đánh giá một đơn vị
 *   INTERNAL — họp nội bộ đoàn đánh giá
 *   CLOSING  — họp kết thúc
 */
export const sessionKindEnum = pgEnum('session_kind', ['OPENING', 'UNIT', 'INTERNAL', 'CLOSING']);

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
  /**
   * Cấp TỔ CHỨC — doanh nghiệp/xí nghiệp sở hữu hệ thống quản lý được đánh giá.
   * Khác hẳn `audit_units` là các phòng/ban/xưởng bên trong tổ chức đó.
   * Dùng đúng từ "tổ chức" theo bản tiếng Việt của ISO 9001/14001/45001.
   */
  organization: text('organization').notNull(),
  title: text('title').notNull(),
  scope: text('scope'),                          // Phạm vi đánh giá

  /* --- Chương trình đánh giá --- */
  objectives: text('objectives'),                // Mục tiêu đánh giá
  criteria: text('criteria'),                    // Chuẩn mực đánh giá
  location: text('location'),                    // Địa điểm
  approverTitle: text('approver_title'),         // Chức danh người phê duyệt (khối ký)
  approverName: text('approver_name'),           // Họ tên người phê duyệt, không bắt buộc
  /** Giờ hiển thị của buổi sáng / buổi chiều. Chỉ dùng để in ra chương trình. */
  amStart: text('am_start').default('08:00').notNull(),
  amEnd: text('am_end').default('11:30').notNull(),
  pmStart: text('pm_start').default('13:30').notNull(),
  pmEnd: text('pm_end').default('17:00').notNull(),
  /** Thời lượng hai cuộc họp cố định, dùng khi sinh lịch tự động. */
  openingMinutes: integer('opening_minutes').default(30).notNull(),
  closingMinutes: integer('closing_minutes').default(90).notNull(),
  /**
   * Khung giờ riêng của từng ngày, đánh chỉ số theo THỨ TỰ NGÀY trong đợt —
   * phần tử 0 là ngày 1. Cùng cách đánh với việc dời ngày đợt, nên đổi khoảng
   * ngày thì khung giờ đi theo mà không phải ánh xạ lại ngày dương lịch.
   *
   * Ngày nào không có phần tử tương ứng thì dùng bốn cột am_start… ở trên.
   */
  dayHours: jsonb('day_hours')
    .$type<{ amStart: string; amEnd: string; pmStart: string; pmEnd: string }[]>()
    .default([])
    .notNull(),

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
/* audit_sessions — lịch đánh giá, mỗi dòng là MỘT BUỔI                 */
/* ------------------------------------------------------------------ */

/**
 * Một phiên có giờ bắt đầu và kết thúc cụ thể, không bó theo buổi.
 *
 * Nhiều phiên chạy song song được, miễn do các đánh giá viên khác nhau phụ
 * trách. Không lưu danh sách đánh giá viên ở đây — người tham gia suy ra từ
 * bảng `assignments` của chính đơn vị đó, nên phân công đổi thì lịch tự đúng
 * theo, không phải sửa hai nơi. Phiên khai mạc và kết thúc thì cả đoàn dự.
 */
export const auditSessions = pgTable(
  'audit_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    auditId: uuid('audit_id')
      .references(() => audits.id, { onDelete: 'cascade' })
      .notNull(),
    /** Ngày diễn ra, dạng "YYYY-MM-DD" — không cần múi giờ vì đây là lịch làm việc. */
    day: text('day').notNull(),
    /** Giờ dạng "HH:MM", luôn rơi vào mốc 15 phút khi sinh tự động. */
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    kind: sessionKindEnum('kind').default('UNIT').notNull(),
    /** Chỉ có với phiên loại UNIT. */
    unitId: uuid('unit_id').references(() => auditUnits.id, { onDelete: 'cascade' }),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    auditIdx: index('audit_sessions_audit_idx').on(t.auditId),
    dayIdx: index('audit_sessions_day_idx').on(t.auditId, t.day, t.startTime),
  }),
);

/* ------------------------------------------------------------------ */
/* findings                                                            */
/* ------------------------------------------------------------------ */

export const findings = pgTable(
  'findings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    auditId: uuid('audit_id').references(() => audits.id, { onDelete: 'cascade' }),
    /** Đơn vị được đánh giá — thay cho ô gõ tay trước đây. */
    unitId: uuid('unit_id').references(() => auditUnits.id, { onDelete: 'set null' }),
    /** Đánh giá viên ghi nhận. */
    memberId: uuid('member_id').references(() => auditMembers.id, { onDelete: 'set null' }),

    code: text('code'),                          // F-01, F-02… trong phạm vi một đợt
    status: findingStatusEnum('status').default('DRAFT').notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),

    /* --- Input thô của auditor --- */
    rawText: text('raw_text').notNull(),
    rawArea: text('raw_area'),                   // Nơi phát hiện (vị trí cụ thể)
    /**
     * `auditee` và `auditorName` giữ lại làm BẢN CHỤP tên tại thời điểm ghi nhận.
     * Nhờ vậy báo cáo cũ vẫn đọc được nguyên vẹn kể cả khi đơn vị bị đổi tên hoặc
     * đánh giá viên bị xoá khỏi đợt.
     */
    auditee: text('auditee'),
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
    unitIdx: index('findings_unit_idx').on(t.unitId),
    memberIdx: index('findings_member_idx').on(t.memberId),
    statusIdx: index('findings_status_idx').on(t.status),
    createdIdx: index('findings_created_idx').on(t.createdAt),
    codeIdx: uniqueIndex('findings_audit_code_idx').on(t.auditId, t.code),
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
/* ai_usage — nhật ký lượt gọi AI                                      */
/* ------------------------------------------------------------------ */

/**
 * Mỗi lượt gọi Claude ghi một dòng. Phục vụ hai việc:
 *
 *  1. GIỚI HẠN TẦN SUẤT — đếm số dòng của một người trong một giờ gần nhất
 *     (xem `lib/ai-quota.ts`). Không cần Redis: một câu COUNT có chỉ mục là đủ
 *     nhanh ở quy mô vài chục đánh giá viên.
 *  2. THEO DÕI CHI PHÍ — tháng vừa rồi tốn bao nhiêu lượt, đợt nào, ai dùng nhiều.
 *
 * CỐ TÌNH KHÔNG ĐẶT KHOÁ NGOẠI. Đây là nhật ký, không phải dữ liệu nghiệp vụ:
 * nó phải còn nguyên kể cả khi đánh giá viên bị xoá khỏi đợt hoặc cả đợt bị xoá.
 * Gắn khoá ngoại kèm ON DELETE CASCADE sẽ làm số liệu chi phí bốc hơi theo.
 */
export const aiUsage = pgTable(
  'ai_usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** "member:<uuid>" hoặc "leader:<uuid>" — xem `actorKey()` trong ai-quota.ts. */
    actorKey: text('actor_key').notNull(),
    actorName: text('actor_name'),
    auditId: uuid('audit_id'),
    /** 'standardize' (từ màn hình ghi nhận) hoặc 'restandardize' (finding đã lưu). */
    kind: text('kind').default('standardize').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    actorIdx: index('ai_usage_actor_time_idx').on(t.actorKey, t.createdAt),
    auditIdx: index('ai_usage_audit_idx').on(t.auditId, t.createdAt),
  }),
);

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
  sessions: many(auditSessions),
  findings: many(findings),
}));

export const auditSessionsRelations = relations(auditSessions, ({ one }) => ({
  audit: one(audits, { fields: [auditSessions.auditId], references: [audits.id] }),
  unit: one(auditUnits, { fields: [auditSessions.unitId], references: [auditUnits.id] }),
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
  unit: one(auditUnits, { fields: [findings.unitId], references: [auditUnits.id] }),
  member: one(auditMembers, { fields: [findings.memberId], references: [auditMembers.id] }),
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
export type AuditSession = typeof auditSessions.$inferSelect;
export type Finding = typeof findings.$inferSelect;
export type FindingImage = typeof findingImages.$inferSelect;
export type AiUsage = typeof aiUsage.$inferSelect;
