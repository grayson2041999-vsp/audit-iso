import {
  pgTable, text, timestamp, uuid, integer, jsonb, pgEnum, index, uniqueIndex, boolean, date,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

/**
 * Một ngày thực hiện của đợt, lưu trong cột `audits.audit_days`: ngày và một
 * hoặc nhiều khoảng giờ làm việc (`ranges`). Các dạng ghi trước đây — một khoảng
 * `start`/`end`, hoặc bốn mốc sáng/chiều — vẫn đọc được qua `resolveAuditDays`.
 */
export type AuditDayRow = {
  date: string; // "YYYY-MM-DD"
  /** Các khoảng giờ làm việc trong ngày, ví dụ 08:00–11:00 và 14:00–17:00. */
  ranges?: { start: string; end: string }[];
  start?: string;
  end?: string;
  amStart?: string; amEnd?: string; pmStart?: string; pmEnd?: string;
  meetingOnly?: boolean;
};

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

/** KHÔNG DÙNG NỮA — trạng thái của luồng cũ đơn vị nộp hồ sơ qua app. Thay bằng `capa_actions`. */
export const capaStatusEnum = pgEnum('capa_status', [
  'PLAN_DRAFT',
  'PLAN_SUBMITTED',
  'PLAN_REJECTED',
  'PLAN_APPROVED',
  'EVIDENCE_SUBMITTED',
  'EVIDENCE_REJECTED',
  'CLOSED',
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
  /** Giờ mặc định của đợt — chỉ dùng để suy ra khoảng giờ cho đợt cũ chưa có `audit_days`. */
  amStart: text('am_start').default('08:00').notNull(),
  amEnd: text('am_end').default('11:30').notNull(),
  pmStart: text('pm_start').default('13:30').notNull(),
  pmEnd: text('pm_end').default('17:00').notNull(),
  /** Thời lượng hai cuộc họp cố định, dùng khi sinh lịch tự động. */
  openingMinutes: integer('opening_minutes').default(30).notNull(),
  closingMinutes: integer('closing_minutes').default(90).notNull(),
  /** KHÔNG DÙNG NỮA — thay bằng `auditDays`. Chỉ còn đọc để suy ra ngày cho đợt cũ. */
  dayHours: jsonb('day_hours')
    .$type<{ amStart: string; amEnd: string; pmStart: string; pmEnd: string }[]>()
    .default([])
    .notNull(),
  /**
   * Ngày thực hiện — danh sách NGÀY CỤ THỂ, đã sắp xếp, không cần liền nhau
   * (khai mạc một ngày, đánh giá vài ngày rời rạc, kết thúc một ngày khác).
   * Mỗi ngày có một hoặc nhiều khoảng giờ làm việc.
   *
   * Mảng rỗng = đợt chưa chuyển, đọc qua `resolveAuditDays` để suy ra từ
   * khoảng ngày. start_date / end_date luôn được ghi bằng ngày đầu và ngày cuối.
   */
  auditDays: jsonb('audit_days').$type<AuditDayRow[]>().default([]).notNull(),

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

  /** KHÔNG DÙNG NỮA — đã bỏ việc gửi báo cáo cho đơn vị qua app. */
  issuedAt: timestamp('issued_at', { withTimezone: true }),
  /** KHÔNG DÙNG NỮA — đã bỏ việc gửi báo cáo cho đơn vị qua app. */
  reportVersion: integer('report_version').default(0).notNull(),

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
    /** KHÔNG DÙNG NỮA — đã bỏ việc gửi báo cáo cho đơn vị qua app. */
    accessCode: text('access_code'),
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
    /** Đơn vị công tác — trùng tên một đơn vị trong đợt thì không được phân công đánh giá đơn vị đó. */
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
/* audit_sessions — lịch đánh giá, mỗi dòng là một phiên                */
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
    /** Đơn vị được đánh giá. */
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
/* report_releases — KHÔNG DÙNG NỮA                                    */
/* ------------------------------------------------------------------ */

export type ReleasedFinding = {
  id: string;
  code: string | null;
  unitId: string | null;
  unitName: string | null;
  severity: string | null;
  title: string | null;
  statement: string | null;
  evidence: string[];
  clauses: { standard: string; clause: string; clauseTitle: string }[];
  rawArea: string | null;
  auditorName: string | null;
  dueDate: string | null;
  observedAt: string | null;
};

/**
 * KHÔNG DÙNG NỮA — bảng của luồng cũ gửi báo cáo / đơn vị nộp hồ sơ khắc phục
 * qua app. Bảng còn trong database; lệnh xoá ở cuối migration 015.
 */
export const reportReleases = pgTable(
  'report_releases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    auditId: uuid('audit_id')
      .references(() => audits.id, { onDelete: 'cascade' })
      .notNull(),
    version: integer('version').notNull(),
    reason: text('reason'),
    releasedBy: text('released_by'),
    snapshot: jsonb('snapshot').$type<ReleasedFinding[]>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ versionIdx: uniqueIndex('report_releases_version_idx').on(t.auditId, t.version) }),
);

/* ------------------------------------------------------------------ */
/* corrective_reports — KHÔNG DÙNG NỮA                                 */
/* ------------------------------------------------------------------ */

/**
 * KHÔNG DÙNG NỮA — bảng của luồng cũ gửi báo cáo / đơn vị nộp hồ sơ khắc phục
 * qua app. Bảng còn trong database; lệnh xoá ở cuối migration 015.
 */
export const correctiveReports = pgTable(
  'corrective_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    auditId: uuid('audit_id')
      .references(() => audits.id, { onDelete: 'cascade' })
      .notNull(),
    unitId: uuid('unit_id')
      .references(() => auditUnits.id, { onDelete: 'cascade' })
      .notNull(),
    status: capaStatusEnum('status').default('PLAN_DRAFT').notNull(),

    responsibleName: text('responsible_name'),
    responsibleTitle: text('responsible_title'),

    round: integer('round').default(1).notNull(),

    planSubmittedAt: timestamp('plan_submitted_at', { withTimezone: true }),
    planReviewedAt: timestamp('plan_reviewed_at', { withTimezone: true }),
    evidenceSubmittedAt: timestamp('evidence_submitted_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),

    reviewNote: text('review_note'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ pairIdx: uniqueIndex('corrective_reports_pair_idx').on(t.auditId, t.unitId) }),
);

/* ------------------------------------------------------------------ */
/* corrective_items — KHÔNG DÙNG NỮA                                   */
/* ------------------------------------------------------------------ */

export type CapaAttachment = {
  key: string;
  fileName: string | null;
  contentType: string | null;
  size: number | null;
};

/**
 * KHÔNG DÙNG NỮA — bảng của luồng cũ gửi báo cáo / đơn vị nộp hồ sơ khắc phục
 * qua app. Bảng còn trong database; lệnh xoá ở cuối migration 015.
 */
export const correctiveItems = pgTable(
  'corrective_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reportId: uuid('report_id')
      .references(() => correctiveReports.id, { onDelete: 'cascade' })
      .notNull(),
    findingId: uuid('finding_id')
      .references(() => findings.id, { onDelete: 'cascade' })
      .notNull(),
    isActive: boolean('is_active').default(true).notNull(),

    immediateAction: text('immediate_action'),
    rootCause: text('root_cause'),
    actionPlan: text('action_plan'),
    targetDate: timestamp('target_date', { withTimezone: true }),

    completionNote: text('completion_note'),
    attachments: jsonb('attachments').$type<CapaAttachment[]>().default([]).notNull(),

    verdict: text('verdict').$type<'OK' | 'NG' | null>(),
    leaderNote: text('leader_note'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ pairIdx: uniqueIndex('corrective_items_pair_idx').on(t.reportId, t.findingId) }),
);

/* ------------------------------------------------------------------ */
/* corrective_events — KHÔNG DÙNG NỮA                                  */
/* ------------------------------------------------------------------ */

/**
 * KHÔNG DÙNG NỮA — bảng của luồng cũ gửi báo cáo / đơn vị nộp hồ sơ khắc phục
 * qua app. Bảng còn trong database; lệnh xoá ở cuối migration 015.
 */
export const correctiveEvents = pgTable(
  'corrective_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reportId: uuid('report_id')
      .references(() => correctiveReports.id, { onDelete: 'cascade' })
      .notNull(),
    round: integer('round').notNull(),
    phase: text('phase').notNull(),
    action: text('action').notNull(),
    actor: text('actor'),
    note: text('note'),
    snapshot: jsonb('snapshot'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ reportIdx: index('corrective_events_report_idx').on(t.reportId, t.createdAt) }),
);

/* ------------------------------------------------------------------ */
/* capa_actions — theo dõi khắc phục, trưởng đoàn tự nhập               */
/* ------------------------------------------------------------------ */

/**
 * Trạng thái một mục khắc phục:
 *   TODO           Chưa thực hiện
 *   IN_PROGRESS    Đang thực hiện
 *   PENDING_REVIEW Chờ kiểm tra — đơn vị báo đã làm, đoàn chưa xác nhận
 *   DONE           Hoàn thành — đoàn đã kiểm tra, tính vào % hoàn thành
 */
export const capaActionStatusEnum = pgEnum('capa_action_status', [
  'TODO', 'IN_PROGRESS', 'PENDING_REVIEW', 'DONE',
]);

/**
 * Một việc cần làm để khắc phục một finding. Một finding có thể có nhiều mục.
 *
 * Đơn vị và phân loại KHÔNG lưu ở đây mà đọc qua finding, nên sửa finding
 * (đổi đơn vị, hạ mức) thì bảng theo dõi tự đúng theo. Xoá finding thì các mục
 * của nó đi theo.
 *
 * Thay cho cả luồng corrective_* cũ: đoàn và đơn vị trao đổi ở ngoài app, app
 * chỉ là sổ theo dõi.
 */
export const capaActions = pgTable(
  'capa_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    auditId: uuid('audit_id')
      .references(() => audits.id, { onDelete: 'cascade' })
      .notNull(),
    findingId: uuid('finding_id')
      .references(() => findings.id, { onDelete: 'cascade' })
      .notNull(),
    /** Nội dung công việc cần thực hiện. */
    content: text('content').notNull(),
    /** KHÔNG DÙNG NỮA — đã bỏ khỏi giao diện. */
    owner: text('owner'),
    dueDate: date('due_date', { mode: 'string' }),
    status: capaActionStatusEnum('status').default('TODO').notNull(),
    /** Ngày hoàn thành — tự điền khi chuyển sang Hoàn thành, sửa được. */
    completedDate: date('completed_date', { mode: 'string' }),
    /** Kết quả kiểm tra / ghi chú của đoàn. */
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    auditIdx: index('capa_actions_audit_idx').on(t.auditId),
    findingIdx: index('capa_actions_finding_idx').on(t.findingId),
  }),
);

/* ------------------------------------------------------------------ */
/* audit_events — nhật ký hành động cấp đợt                            */
/* ------------------------------------------------------------------ */

/** Nhật ký hành động cấp đợt: khoá và mở lại đợt. */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    auditId: uuid('audit_id')
      .references(() => audits.id, { onDelete: 'cascade' })
      .notNull(),
    actor: text('actor'),
    action: text('action').notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ auditIdx: index('audit_events_audit_idx').on(t.auditId, t.createdAt) }),
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
  correctiveReports: many(correctiveReports),
}));

export const correctiveReportsRelations = relations(correctiveReports, ({ one, many }) => ({
  audit: one(audits, { fields: [correctiveReports.auditId], references: [audits.id] }),
  unit: one(auditUnits, { fields: [correctiveReports.unitId], references: [auditUnits.id] }),
  items: many(correctiveItems),
  events: many(correctiveEvents),
}));

export const correctiveItemsRelations = relations(correctiveItems, ({ one }) => ({
  report: one(correctiveReports, {
    fields: [correctiveItems.reportId],
    references: [correctiveReports.id],
  }),
  finding: one(findings, { fields: [correctiveItems.findingId], references: [findings.id] }),
}));

export const correctiveEventsRelations = relations(correctiveEvents, ({ one }) => ({
  report: one(correctiveReports, {
    fields: [correctiveEvents.reportId],
    references: [correctiveReports.id],
  }),
}));

export const reportReleasesRelations = relations(reportReleases, ({ one }) => ({
  audit: one(audits, { fields: [reportReleases.auditId], references: [audits.id] }),
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
export type ReportRelease = typeof reportReleases.$inferSelect;
export type CorrectiveReport = typeof correctiveReports.$inferSelect;
export type CorrectiveItem = typeof correctiveItems.$inferSelect;
export type CorrectiveEvent = typeof correctiveEvents.$inferSelect;
export type CapaAction = typeof capaActions.$inferSelect;
