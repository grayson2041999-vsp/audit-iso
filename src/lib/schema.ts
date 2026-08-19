import {
  pgTable, text, timestamp, uuid, integer, jsonb, pgEnum, index, uniqueIndex, boolean,
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

/**
 * Vòng đời gói khắc phục của một đơn vị. HAI mốc duyệt, không phải một:
 *
 *   PLAN_DRAFT         đơn vị đang soạn kế hoạch
 *   PLAN_SUBMITTED     đã trình kế hoạch, chờ trưởng đoàn duyệt
 *   PLAN_REJECTED      trả lại, đơn vị sửa rồi trình lại
 *   PLAN_APPROVED      kế hoạch được duyệt — đơn vị đi làm
 *   EVIDENCE_SUBMITTED đã nộp bằng chứng hoàn thành, chờ xác nhận
 *   EVIDENCE_REJECTED  bằng chứng chưa đạt, làm lại
 *   CLOSED             trưởng đoàn xác nhận hiệu lực, đóng
 *
 * Mốc 2 tồn tại vì ISO 9001 §10.2.1 e) đòi "xem xét hiệu lực của mọi hành động
 * khắc phục ĐÃ THỰC HIỆN" — duyệt kế hoạch mới là đồng ý cách làm, chưa phải
 * xác nhận nó có tác dụng.
 */
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

  /**
   * Đã gửi báo cáo cho các đơn vị được đánh giá chưa. NULL = chưa.
   *
   * Cố tình KHÔNG thêm giá trị vào `audit_status`: cùng cách nghĩ với phần còn
   * lại của app — trạng thái là hệ quả của hành động, không phải một nút riêng.
   */
  issuedAt: timestamp('issued_at', { withTimezone: true }),
  /** Số bản báo cáo đã phát hành. 0 = chưa lần nào. */
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
    /**
     * Mã 8 số để đơn vị vào xem báo cáo và nộp hồ sơ khắc phục. Chỉ có sau khi
     * trưởng đoàn bấm "Gửi báo cáo cho đơn vị".
     *
     * Lưu dạng đọc được, giống mã 6 số của đánh giá viên — trưởng đoàn phải tra
     * lại được cho đơn vị quên mã.
     */
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
/* report_releases — mỗi lần phát hành báo cáo cho đơn vị              */
/* ------------------------------------------------------------------ */

/** Một finding như nó được nhìn thấy tại thời điểm phát hành. */
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
 * ĐƠN VỊ ĐỌC ẢNH CHỤP, KHÔNG ĐỌC DỮ LIỆU SỐNG — điểm mấu chốt của thiết kế.
 *
 * Trưởng đoàn có mở đợt ra sửa gì thì bên đơn vị vẫn thấy đúng bản đã gửi, cho
 * tới khi bấm phát hành bản mới kèm lý do. Nhờ vậy vừa không khoá chết báo cáo
 * (còn sửa được lỗi chính tả, rút một finding sai), vừa không ai sửa lén được
 * thứ đã gửi đi — đúng tinh thần ISO 9001 §7.5.3 về kiểm soát thông tin dạng
 * văn bản, và chặt hơn kiểu khoá chết vì khoá chết chỉ đẩy người ta ra ngoài
 * hệ thống.
 */
export const reportReleases = pgTable(
  'report_releases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    auditId: uuid('audit_id')
      .references(() => audits.id, { onDelete: 'cascade' })
      .notNull(),
    version: integer('version').notNull(),
    /** Bắt buộc từ bản 2 trở đi — kiểm ở tầng ứng dụng, bản 1 không cần. */
    reason: text('reason'),
    releasedBy: text('released_by'),
    snapshot: jsonb('snapshot').$type<ReleasedFinding[]>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ versionIdx: uniqueIndex('report_releases_version_idx').on(t.auditId, t.version) }),
);

/* ------------------------------------------------------------------ */
/* corrective_reports — một gói khắc phục cho một đơn vị               */
/* ------------------------------------------------------------------ */

/**
 * Đơn vị nộp CẢ GÓI một lần, không nộp lẻ từng finding.
 *
 * Đổi lại, trưởng đoàn vẫn chấm được TỪNG FINDING qua cột `verdict` ở
 * `corrective_items` — trả lại cả gói nhưng đơn vị biết chính xác mục nào chưa
 * đạt, không phải làm lại từ đầu.
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

    /**
     * Lãnh đạo phòng đứng tên chịu trách nhiệm. Mã 8 số dùng chung cả đơn vị
     * nên đây là chỗ DUY NHẤT ghi được ai đứng ra cam kết — mà ISO 9001
     * §10.2.2 lại yêu cầu lưu hồ sơ hành động đã thực hiện.
     */
    responsibleName: text('responsible_name'),
    responsibleTitle: text('responsible_title'),

    /** Lần nộp thứ mấy; tăng mỗi khi trưởng đoàn trả lại. */
    round: integer('round').default(1).notNull(),

    planSubmittedAt: timestamp('plan_submitted_at', { withTimezone: true }),
    planReviewedAt: timestamp('plan_reviewed_at', { withTimezone: true }),
    evidenceSubmittedAt: timestamp('evidence_submitted_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),

    /** Ghi chú lần duyệt gần nhất — lý do trả lại, hoặc nhận xét khi duyệt. */
    reviewNote: text('review_note'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ pairIdx: uniqueIndex('corrective_reports_pair_idx').on(t.auditId, t.unitId) }),
);

/* ------------------------------------------------------------------ */
/* corrective_items — mỗi sự không phù hợp một dòng                    */
/* ------------------------------------------------------------------ */

export type CapaAttachment = {
  key: string;
  fileName: string | null;
  contentType: string | null;
  size: number | null;
};

/**
 * Chỉ tạo cho finding mức MAJOR và MINOR — xem `NEEDS_CAPA` trong `lib/capa.ts`.
 * OBS / OFI / CONF không bắt buộc khắc phục; bắt đơn vị làm hồ sơ CAPA cho một
 * cơ hội cải tiến là cách nhanh nhất khiến họ ghét cả công cụ lẫn việc đánh giá.
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
    /**
     * Phát hành bản mới có thể làm một finding thôi không còn là NC (bị hạ mức
     * hoặc rút). KHÔNG xoá dòng — đơn vị đã gõ nội dung vào đó — mà tắt đi, để
     * lịch sử còn nguyên và bật lại được nếu bản sau đảo ngược quyết định.
     */
    isActive: boolean('is_active').default(true).notNull(),

    /* --- Mốc 1: kế hoạch --- */
    immediateAction: text('immediate_action'),
    rootCause: text('root_cause'),
    actionPlan: text('action_plan'),
    targetDate: timestamp('target_date', { withTimezone: true }),

    /* --- Mốc 2: bằng chứng đã thực hiện --- */
    completionNote: text('completion_note'),
    attachments: jsonb('attachments').$type<CapaAttachment[]>().default([]).notNull(),

    /** Trưởng đoàn chấm từng mục: null chưa chấm · 'OK' đạt · 'NG' chưa đạt. */
    verdict: text('verdict').$type<'OK' | 'NG' | null>(),
    leaderNote: text('leader_note'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ pairIdx: uniqueIndex('corrective_items_pair_idx').on(t.reportId, t.findingId) }),
);

/* ------------------------------------------------------------------ */
/* corrective_events — nhật ký nộp / duyệt / trả lại                   */
/* ------------------------------------------------------------------ */

/**
 * Mỗi lần nộp hoặc duyệt ghi một dòng kèm ảnh chụp toàn bộ gói. Bản bị trả lại
 * KHÔNG bị ghi đè, nên sau này đọc lại được vì sao đơn vị phải làm tới lần ba.
 */
export const correctiveEvents = pgTable(
  'corrective_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reportId: uuid('report_id')
      .references(() => correctiveReports.id, { onDelete: 'cascade' })
      .notNull(),
    round: integer('round').notNull(),
    /** 'plan' | 'evidence' */
    phase: text('phase').notNull(),
    /** 'submit' | 'approve' | 'reject' */
    action: text('action').notNull(),
    actor: text('actor'),
    note: text('note'),
    snapshot: jsonb('snapshot'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ reportIdx: index('corrective_events_report_idx').on(t.reportId, t.createdAt) }),
);

/* ------------------------------------------------------------------ */
/* audit_events — nhật ký hành động cấp đợt                            */
/* ------------------------------------------------------------------ */

/**
 * Chỗ ghi những việc phải truy được về sau: khoá đợt, mở lại sau khi đã phát
 * hành, phát hành bản mới. Mở khoá một đợt ĐÃ GỬI cho đơn vị là hành động nhạy
 * cảm nhất trong app — bắt buộc kèm lý do và phải để lại dấu.
 */
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
