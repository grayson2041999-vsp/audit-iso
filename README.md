# Chuẩn hoá Finding ISO — App hỗ trợ auditor nội bộ

Auditor nhập ghi nhận thô tại hiện trường (kèm ảnh, không bắt buộc) → AI đọc, đối chiếu điều khoản
và viết lại thành **phát biểu finding đạt chuẩn ISO** theo cấu trúc **R–N–E**
(Yêu cầu – Sự không phù hợp – Bằng chứng khách quan).

Hỗ trợ **ISO 9001:2015**, **ISO 14001:2015**, **ISO 45001:2018** — chọn 1, 2 hoặc cả 3 cho từng finding.

| Lớp | Công nghệ |
|---|---|
| Front-end | Next.js 15 (App Router) + React 19 + Tailwind CSS |
| Back-end | Next.js Route Handlers + Neon Postgres (serverless) + Drizzle ORM |
| Storage | Cloudflare R2 (S3-compatible, upload trực tiếp bằng presigned URL) |
| AI | Anthropic Claude API (có vision để đọc ảnh hiện trường) |

---

## 1. Cài đặt

```bash
npm install
cp .env.example .env.local   # rồi điền giá trị thật
```

### Neon

1. Tạo project tại https://console.neon.tech
2. Copy **Pooled connection string** → dán vào `DATABASE_URL`
3. Tạo bảng:

```bash
psql "$DATABASE_URL" -f db/init.sql
# hoặc dán nội dung db/init.sql vào Neon SQL Editor
# hoặc dùng Drizzle: npm run db:push
```

### Cloudflare R2

1. Cloudflare Dashboard → **R2** → Create bucket (VD: `audit-findings`)
2. **Manage R2 API Tokens** → Create API token (quyền *Object Read & Write*)
   → lấy `Access Key ID`, `Secret Access Key`, `Account ID`
3. Bucket để **private** — app tự sinh presigned URL khi cần xem ảnh.
4. **CORS** (bắt buộc, vì trình duyệt PUT thẳng lên R2). Bucket → Settings → CORS policy:

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000", "https://your-domain.com"],
    "AllowedMethods": ["PUT", "GET"],
    "AllowedHeaders": ["content-type"],
    "MaxAgeSeconds": 3600
  }
]
```

### Anthropic

Lấy API key tại https://console.anthropic.com → điền `ANTHROPIC_API_KEY`.

```bash
npm run dev   # http://localhost:3000
```

---

## 2. Luồng nghiệp vụ

```
Auditor gõ ghi nhận thô  ──┐
Ảnh hiện trường (optional) ┴─► POST /api/uploads/presign
                                 └─► trình duyệt PUT thẳng lên R2
                                       │
                              POST /api/standardize
                                 ├─ tải ảnh từ R2 → base64
                                 ├─ nạp danh mục điều khoản ISO đã chọn
                                 ├─ gọi Claude (system prompt Lead Auditor)
                                 └─ Zod validate + hậu kiểm mã điều khoản
                                       │
                              Auditor rà soát / sửa trên UI
                                       │
                              POST /api/findings  → lưu Neon
                                       │
                    DRAFT → AI_DRAFTED → REVIEWED → ISSUED → CLOSED
```

Mọi lần sửa đều được ghi vào bảng `finding_revisions` (snapshot JSON) để truy vết.

---

## 3. Quy tắc chuẩn hoá mà AI tuân thủ

1. **Cấu trúc R–N–E** — mỗi finding phải nêu đủ Yêu cầu bị vi phạm, bản chất sai lệch, và bằng chứng kiểm chứng được.
2. **Không bịa dữ kiện** — AI không tự tạo số hiệu tài liệu / ngày tháng / mã thiết bị. Thiếu gì thì đưa vào `missingInfo` để auditor bổ sung.
3. **Viện dẫn có kiểm soát** — AI chỉ được dùng mã điều khoản trong danh mục `src/lib/iso.ts`; server hậu kiểm và loại bỏ mã bịa.
4. **Văn phong audit** — khách quan, không quy kết cá nhân, không nêu nguyên nhân gốc, không viết finding dưới dạng giải pháp.
5. **Một finding = một sự không phù hợp**; vấn đề phụ được gợi ý tách riêng.
6. **Phân loại** MAJOR / MINOR / OBS / OFI / CONF kèm lý do phân loại.
7. **Ảnh là bằng chứng** — AI chỉ mô tả những gì quan sát được, cảnh báo nếu ảnh mâu thuẫn với mô tả văn bản.

Tuỳ chỉnh quy tắc: sửa `SYSTEM_PROMPT` trong `src/lib/prompt.ts`.
Thêm/sửa điều khoản, thêm tiêu chuẩn mới (VD ISO 27001): sửa `src/lib/iso.ts`.

---

## 4. Cấu trúc mã nguồn

```
src/
├── app/
│   ├── page.tsx                    Dashboard: thống kê + finding gần đây
│   ├── findings/page.tsx           Bảng danh sách
│   ├── findings/new/page.tsx       Màn hình ghi nhận & chuẩn hoá
│   ├── findings/[id]/page.tsx      Chi tiết finding
│   └── api/
│       ├── uploads/presign/        Cấp presigned PUT URL cho R2
│       ├── standardize/            Gọi Claude chuẩn hoá
│       ├── findings/               GET danh sách · POST tạo mới
│       ├── findings/[id]/          GET · PATCH · DELETE
│       └── audits/                 Quản lý cuộc đánh giá
├── components/
│   ├── FindingWorkbench.tsx        Form 2 cột: nhập ↔ kết quả có thể sửa
│   ├── ImageUploader.tsx           Kéo-thả, upload thẳng lên R2
│   ├── FindingActions.tsx          Đổi trạng thái, sao chép, xoá
│   └── Badge.tsx
└── lib/
    ├── iso.ts        Danh mục điều khoản 3 tiêu chuẩn
    ├── prompt.ts     System prompt Lead Auditor + user prompt
    ├── ai.ts         Client Claude, vision, parse & hậu kiểm
    ├── r2.ts         S3 client cho R2, presign, đọc ảnh base64
    ├── schema.ts     Drizzle schema
    ├── db.ts         Kết nối Neon
    └── types.ts      Zod schema cho API
```

---

## 5. API

| Method | Endpoint | Mô tả |
|---|---|---|
| POST | `/api/uploads/presign` | Trả về `{key, uploadUrl}` cho từng file |
| POST | `/api/standardize` | Chuẩn hoá finding bằng AI (không ghi DB) |
| GET | `/api/findings?q=&status=&severity=` | Danh sách finding |
| POST | `/api/findings` | Lưu finding (kèm ảnh) |
| GET | `/api/findings/:id` | Chi tiết + URL ảnh presigned |
| PATCH | `/api/findings/:id` | Cập nhật (tự lưu revision) |
| DELETE | `/api/findings/:id` | Xoá finding + ảnh trên R2 |
| GET/POST | `/api/audits` | Cuộc đánh giá |

---

## 6. Triển khai

Vercel là lựa chọn tự nhiên (Neon + R2 đều serverless-friendly):

```bash
vercel
# thêm các biến trong .env.example vào Project Settings → Environment Variables
```

Nhớ thêm domain production vào **CORS policy của R2 bucket**.

---

## 6b. Migration đã áp dụng

Cài mới thì chỉ cần chạy `db/init.sql` — đã bao gồm mọi thay đổi. Các file dưới đây
dành cho database đã tồn tại từ trước:

| File | Nội dung |
|---|---|
| `db/migration-001-auditee-duedate.sql` | Thêm `auditee` (đơn vị được đánh giá) và `due_date` (thời hạn khắc phục) |
| `db/migration-002-drop-unused-columns.sql` | Xoá `requirement`, `nonconformity`, `risk_analysis`, `suggested_action`, `confidence` — các trường AI không còn sinh ra |

**Thứ tự bắt buộc khi migration có xoá cột:** push code trước, đợi Vercel build xong,
rồi mới chạy SQL. Làm ngược lại sẽ có một khoảng thời gian bản deploy cũ hỏi những cột
đã bị xoá và mọi truy vấn `findings` sẽ lỗi.

Thêm cột thì ngược lại — chạy SQL trước, push code sau — vì cột mới không làm phiền code cũ.

---

## 7. Lưu ý khi vận hành

- **AI là trợ lý, không phải người quyết định.** Auditor phải rà soát mọi phát biểu trước khi chuyển trạng thái `REVIEWED`. Trường `confidence` và `missingInfo` là tín hiệu để ưu tiên rà soát.
- Chưa có lớp xác thực người dùng — nếu triển khai nội bộ thật, bổ sung auth (NextAuth / Clerk / SSO công ty) và phân quyền theo vai trò auditor / trưởng đoàn.
- Ảnh gửi lên Claude tối đa 6 tấm mỗi lần gọi (`MAX_IMAGES` trong `src/lib/ai.ts`).
- Danh mục điều khoản chỉ chứa **mã và tiêu đề** điều khoản, không sao chép nội dung tiêu chuẩn (vấn đề bản quyền ISO).
