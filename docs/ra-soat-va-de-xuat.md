# Rà soát app `audit-iso` — điểm cần cải thiện & chức năng nên bổ sung

*Ngày rà soát: 19/08/2026 · Phạm vi: toàn bộ `src/`, `db/`, `docs/`, `package.json`*

---

## 0. Nhận xét chung

Đây là một codebase **chất lượng cao hơn mặt bằng chung rất nhiều**. Những thứ đáng ghi nhận:

- **Mô hình dữ liệu đúng nghiệp vụ.** Tách `organization` (tổ chức) khỏi `audit_units` (phòng/ban) là đúng ngôn ngữ ISO. Lưu `auditee` / `auditor_name` dạng bản chụp tên để báo cáo cũ không vỡ khi đổi tên đơn vị — đây là tư duy của người hiểu hồ sơ, không phải người chỉ viết CRUD.
- **Sinh mã finding nguyên tử** bằng `UPDATE ... RETURNING` + unique index `(audit_id, code)` — xử lý đúng race condition, có ghi rõ lý do trong `docs/concept-mo-rong.md` §8b.
- **Prompt engineering thực sự tốt.** Việc đặt `severityRationale` **trước** `severity` trong `input_schema` để ép model lập luận rồi mới chốt mức, và bốn khuôn phát biểu khác nhau cho MAJOR/MINOR · OBS · OFI · CONF — đây là chỗ đa số app AI-audit làm sai (nống mọi thứ thành NC). Hậu kiểm mã điều khoản bằng `isValidClause()` để loại viện dẫn bịa cũng rất đúng.
- **Lịch bám theo thứ tự ngày trong đợt** thay vì ngày dương lịch, nên dời cả đợt không phải sắp lại lịch (`api/audits/[id]/route.ts`). Xử lý rất chín.
- **Comment giải thích "vì sao"**, không phải "cái gì". Cảnh báo `cache()` của React vs `unstable_cache` trong `auth.ts` là kiểu ghi chú cứu người bảo trì sau này.

Phần còn lại của tài liệu là những chỗ chưa ổn và những chỗ còn thiếu.

---

## PHẦN A — VẤN ĐỀ CẦN SỬA

### A1. Bảo mật — 3 lỗ hổng nên vá trước khi đưa vào dùng thật

**✅ A1.1 — `/api/standardize` không có bất kỳ lớp xác thực nào** *(ĐÃ SỬA 19/08/2026)*

`src/app/api/standardize/route.ts` chỉ kiểm tra `isAiConfigured()` rồi gọi thẳng Claude. Bất kỳ ai biết URL đều POST được và tiêu tiền API của bạn không giới hạn — mỗi request tới 8192 token đầu ra kèm 6 ảnh. Đây là dạng lỗ hổng bị quét tự động tìm ra rất nhanh sau khi deploy public.

*Đã sửa như sau:* `standardizeRequestSchema` nhận thêm `auditId` (bắt buộc) → route gọi `resolveAiActor(auditId)` trong `lib/ai-quota.ts`, thử cookie đánh giá viên trước rồi tới trưởng đoàn sở hữu đợt, không ai khớp thì trả 401. Kèm hạn mức **20 lượt/giờ** theo cửa sổ trượt, đếm trên bảng `ai_usage` mới (`db/migration-011-ai-usage.sql`), trả 429 kèm `Retry-After`. Hạn mức áp cho cả `/api/dot/[id]/findings/[fid]/chuan-hoa` để không chặn cửa trước mà bỏ ngỏ cửa sau. Chỉ tính lượt khi AI trả kết quả thành công.

**🔴 A1.2 — `/api/uploads/presign` cũng không có xác thực**

`src/app/api/uploads/presign/route.ts` cấp presigned PUT URL cho bất kỳ ai gọi. Có kiểm tra content-type và dung lượng, nhưng người gọi tự khai `size` trong JSON — không ràng buộc gì phía R2, nên hoàn toàn PUT được file lớn hơn nhiều. Kết quả: bucket của bạn thành kho lưu trữ miễn phí cho người lạ.

*Cách sửa:* (1) thêm xác thực như trên; (2) truyền `ContentLength` vào lệnh presign để R2 tự từ chối file quá cỡ; (3) đặt object key theo `auditId/findingId/` để rác có thể dọn được.

**🟠 A1.3 — Mã 6 số không có giới hạn số lần thử**

`src/app/api/dot/[id]/vao/route.ts` cho thử vô hạn. Danh sách tên đánh giá viên hiển thị công khai trên trang đợt, nên chỉ cần một script quay 10⁶ khả năng là vào được với tư cách bất kỳ ai. Tài liệu `concept-mo-rong.md` §7 đã tự nhận ra điều này ("đây là chỗ cần sửa đầu tiên") — đề nghị làm luôn:

- Thêm cột `failed_attempts` + `locked_until` trên `audit_members`, khoá 15 phút sau 5 lần sai.
- Cân nhắc nâng mã lên 8 ký tự chữ + số (khoảng 2,8 nghìn tỷ khả năng thay vì 1 triệu) — vẫn gõ được trên điện thoại.
- Ghi log mọi lần vào đợt (thời điểm, IP) — vừa để chống dò, vừa là bằng chứng ai đã truy cập hồ sơ.

**Ghi chú:** mã lưu dạng đọc được là *đánh đổi có chủ đích* (trưởng đoàn tra lại cho người quên) — chấp nhận được, nhưng nên đi kèm khoá thử sai thì mới cân bằng.

---

### A2. Tính toàn vẹn hồ sơ — điểm yếu nghiêm trọng nhất với một app audit

Một công cụ đánh giá nội bộ có yêu cầu cao hơn app thường: **hồ sơ phải chứng minh được là chưa bị sửa đổi âm thầm**. Đây là chỗ app đang hụt.

**🔴 A2.1 — Trưởng đoàn xoá finding là xoá vĩnh viễn, không để lại dấu vết**

`api/audits/[id]/findings/[fid]/route.ts` → `DELETE` chạy `db.delete(findings)` và xoá luôn ảnh trên R2. Không ghi revision, không soft-delete. Nghĩa là **trưởng đoàn có thể xoá sạch một Major NC bất lợi và không ai chứng minh được nó từng tồn tại** — kể cả finding do đánh giá viên khác ghi và đã nộp.

Với ISO 9001 §7.5.3 (kiểm soát thông tin dạng văn bản) và nguyên tắc "evidence-based" của ISO 19011, đây là lỗi thiết kế chứ không phải thiếu tính năng.

*Cách sửa:* thêm cột `deleted_at` + `deleted_by` + `delete_reason` (bắt buộc nhập lý do), lọc `IS NULL` ở mọi truy vấn hiển thị. Ảnh R2 giữ lại. Trưởng đoàn xem được thùng rác, phục hồi được.

**🟠 A2.2 — Bảng `finding_revisions` chỉ ghi vào, không đọc ra ở đâu**

Grep toàn bộ `src/`: bảng này chỉ xuất hiện trong hai route PATCH và trong schema. **Không màn hình nào hiển thị lịch sử sửa.** Dữ liệu quý nhất của app đang nằm chết trong database.

*Cách sửa:* thêm mục "Lịch sử chỉnh sửa" ở trang chi tiết finding — ai sửa, lúc nào, trường nào đổi từ gì sang gì. Chỉ cần diff hai snapshot JSON. Đây là tính năng rẻ nhất mà tăng độ tin cậy của app nhiều nhất.

**🟠 A2.3 — Không có nhật ký hành động cấp đợt**

Không có bản ghi cho: ai khoá đợt, ai mở lại đợt (`/mo-dot`), ai sinh mã, ai đổi ngày đợt, ai xoá đơn vị. Việc **mở lại đợt đã khoá** đặc biệt cần log — đó là cửa để sửa hồ sơ sau khi đã phát hành.

*Cách sửa:* một bảng `audit_events (audit_id, actor, action, payload, created_at)`, ghi ở mọi route ghi dữ liệu. ~30 dòng code, giá trị rất lớn.

**🟡 A2.4 — Chỉ chủ sở hữu đợt truy cập được**

`getOwnedAudit()` khoá cứng theo `leaderId`. Hệ quả: người phụ trách ISO/QA của tổ chức không xem được đợt do người khác tạo; trưởng đoàn nghỉ việc là đợt thành mồ côi, không chuyển giao được. Với app "nội bộ một tổ chức" thì mô hình này quá hẹp.

*Cách sửa:* thêm bảng `organizations` + `org_members(role: OWNER|QA|LEADER|VIEWER)`, quyền tính theo tổ chức thay vì theo cá nhân.

---

### A3. Chất lượng mã & vận hành

| # | Vấn đề | Vị trí | Ghi chú |
|---|---|---|---|
| 🟠 | **Không có một dòng test nào**, `package.json` không có script `test` | toàn bộ repo | `lib/plan.ts` (30 KB, thuật toán sinh lịch) và `lib/assign.ts` là nơi lỗi tính toán sẽ âm thầm hỏng lịch. Đây là ứng viên số một cho unit test — Vitest, ~15 test là đủ chặn hồi quy. |
| 🟠 | **README lạc hậu nặng** | `README.md` §4, §5, §7 | Mô tả `findings/new/page.tsx`, `FindingWorkbench.tsx`, `/api/findings` — **không cái nào còn tồn tại**. Vẫn ghi "Chưa có lớp xác thực người dùng" trong khi `auth.ts` + `member-auth.ts` đã có từ lâu. Người mới (hoặc chính bạn sau 6 tháng) sẽ đi lạc. |
| 🟡 | **Thiếu `AUTH_SECRET` biểu hiện thành "ai cũng bị đăng xuất"** | `lib/auth.ts:32,128` · `lib/member-auth.ts:77` | `isAuthConfigured()` trả về `false` và `getLeader()`/`getMember()` nuốt mọi lỗi rồi trả `null`. Deploy quên biến môi trường sẽ ra hiện tượng "đăng nhập xong vẫn bị đá ra", không có thông báo nào chỉ đúng nguyên nhân. Nên fail-fast lúc khởi động, hoặc hiện banner cảnh báo cấu hình. |
| 🟡 | `updateFindingSchema` là code chết | `lib/types.ts:73` | Không được import ở đâu, và còn dùng trạng thái cũ `AI_DRAFTED`/`ISSUED`. Xoá đi để không ai nhầm đây là schema thật. |
| 🟡 | Rơi rớt mã model mặc định ở hai nơi | `lib/ai.ts:7` và `api/dot/[id]/findings/route.ts:84` | Cùng chuỗi `'claude-sonnet-5'` viết tay hai lần. Route nên import `MODEL` từ `lib/ai.ts`. |
| 🟡 | `maxDuration = 120` | `api/standardize/route.ts:6` | Kiểm tra lại giới hạn thực tế của gói Vercel đang dùng — nếu bị cắt ở 60s thì stream đứt giữa chừng mà không có thông báo rõ. |
| 🟡 | Đợt không cập nhật `updated_at` | `api/audits/[id]/route.ts` PATCH | Cột có trong schema nhưng PATCH không set. Danh sách đợt sắp xếp theo thời gian sửa sẽ sai. |
| 🟢 | Ô thống kê bỏ sót CONF | `quan-ly/dot/[id]/tong-hop/page.tsx:81` | Bốn ô MAJOR/MINOR/OBS/OFI, không có CONF — dù bộ lọc bên dưới vẫn có. Finding "phù hợp/điểm mạnh" ghi vào rồi biến mất khỏi tầm mắt, làm nản việc ghi nhận điểm tốt. |

---

### A4. Trải nghiệm sử dụng tại hiện trường

Đây là nhóm vấn đề "app chạy đúng nhưng khó dùng ở nhà xưởng":

- **Không hoạt động khi mất mạng.** Đánh giá viên đứng trong xưởng, hầm, kho lạnh — sóng chập chờn là chuyện thường. Hiện mọi thao tác lưu đều cần mạng; mất kết nối giữa chừng là mất nội dung vừa gõ. Cần tối thiểu: tự lưu nháp vào `IndexedDB` và đồng bộ lại khi có mạng (xem C2.4).
- **Không có nhập liệu bằng giọng nói.** Auditor cầm điện thoại một tay, tay kia cầm hồ sơ. Gõ 3–5 câu ghi nhận thô trên điện thoại là rào cản lớn nhất khiến người ta bỏ app quay về sổ giấy. Web Speech API hoặc Whisper qua một nút "giữ để nói" sẽ thay đổi hẳn tỉ lệ sử dụng.
- **`FindingEntry.tsx` 20 KB, `AuditPlan.tsx` 34 KB, `ScheduleGrid.tsx` 24 KB.** Chưa phải lỗi, nhưng ba file này sẽ là chỗ khó sửa nhất trong 6 tháng tới. Nên tách logic (state machine của luồng chuẩn hoá) ra khỏi phần hiển thị.

---

## PHẦN B — CHỨC NĂNG NÊN THÊM CHO ĐÁNH GIÁ NỘI BỘ

App hiện đang phủ rất tốt **giai đoạn giữa** của một cuộc đánh giá: chuẩn bị đợt → phân công → ghi nhận → chuẩn hoá → tổng hợp. Nhưng vòng đời đánh giá nội bộ theo ISO 19011 và ISO 9001 §9.2 rộng hơn thế. Dưới đây là những mảnh còn thiếu, xếp theo trình tự thời gian của một cuộc đánh giá.

### B1. Trước đánh giá — Hoạch định

**⭐ B1.1 — Chương trình đánh giá năm (audit programme)**

Đây là **khoảng trống lớn nhất về mặt tuân thủ**. ISO 9001 §9.2.2 a) yêu cầu tổ chức *"hoạch định, thiết lập, thực hiện và duy trì (các) chương trình đánh giá, bao gồm tần suất, phương pháp, trách nhiệm, yêu cầu hoạch định và báo cáo"*, có xét *"tầm quan trọng của các quá trình liên quan"* và *"kết quả của các cuộc đánh giá trước đó"*.

App hiện chỉ có khái niệm **đợt** (một cuộc đánh giá đơn lẻ). Không có cấp trên nó.

Cần thêm một thực thể `audit_programmes` (chu kỳ 1 năm) chứa nhiều đợt, với:

- Ma trận **đơn vị × điều khoản × quý** — nhìn một màn hình biết cả năm đã phủ hết chưa.
- Cảnh báo đơn vị/quá trình chưa được đánh giá trong chu kỳ.
- Tần suất đề xuất theo mức rủi ro của đơn vị (đơn vị rủi ro cao đánh giá 2 lần/năm).
- Xuất được "Kế hoạch đánh giá nội bộ năm 20XX" để trình lãnh đạo phê duyệt.

Khi đi chứng nhận, đây là tài liệu đầu tiên đánh giá viên bên ngoài đòi xem.

**⭐ B1.2 — Danh mục dùng chung (master data)**

`concept-mo-rong.md` §7 đã ghi nhận đánh đổi: đơn vị và đánh giá viên nhập lại mỗi đợt, nên "Phòng Kỹ thuật" và "P. Kỹ thuật" thành hai đơn vị khác nhau. **Đến lúc trả nợ khoản này** — vì mọi tính năng phân tích xu hướng ở B4 đều chết nếu không có ID ổn định qua các năm.

Đề xuất: bảng `org_units` và `auditors` ở cấp tổ chức; `audit_units`/`audit_members` của từng đợt tham chiếu tới chúng (`source_unit_id`), vẫn cho phép sửa tên cục bộ trong đợt.

**B1.3 — Hồ sơ năng lực & tuyên bố độc lập của đánh giá viên**

ISO 9001 §9.2.2 c) yêu cầu *"lựa chọn đánh giá viên và tiến hành đánh giá đảm bảo tính khách quan và vô tư"*. App có `home_unit` để cảnh báo, nhưng chưa có:

- Hồ sơ đánh giá viên: khoá đào tạo, chứng chỉ (nội bộ/IRCA), ngày hết hạn, tiêu chuẩn được phép đánh giá, số cuộc đã tham gia.
- **Chặn cứng** (không chỉ cảnh báo) việc phân công người vào chính đơn vị mình.
- **Tuyên bố xung đột lợi ích** — đánh giá viên tick xác nhận khi vào đợt, lưu làm hồ sơ.
- Cảnh báo khi đoàn không có ai đủ năng lực cho một tiêu chuẩn đã chọn (VD chọn ISO 45001 nhưng không ai có chứng chỉ ATSKNN).

**B1.4 — Checklist đánh giá theo điều khoản**

Hiện auditor vào đơn vị với màn hình trắng. Nên có bộ câu hỏi kiểm tra sinh sẵn:

- Chọn điều khoản áp dụng cho đơn vị → sinh danh sách câu hỏi (tự soạn, hoặc để AI đề xuất từ `lib/iso.ts` + đặc thù đơn vị).
- Mỗi dòng tick: Phù hợp / Không phù hợp / Không áp dụng / Cần xem thêm, kèm ô ghi bằng chứng đã xem.
- Dòng "Không phù hợp" chuyển thẳng thành finding, kéo theo điều khoản và ghi chú.
- **Thanh phủ điều khoản**: "Đơn vị này đã xem 12/18 điều khoản dự kiến" — chống bỏ sót.

Đây là thứ auditor dùng nhiều nhất trong ngày làm việc, và cũng là hồ sơ chứng minh cuộc đánh giá được thực hiện có hệ thống.

**B1.5 — Thư thông báo đánh giá gửi đơn vị**

Sinh sẵn văn bản thông báo (thời gian, phạm vi, đoàn đánh giá, tài liệu đơn vị cần chuẩn bị) từ dữ liệu đợt. Hiện phải soạn tay ngoài app.

---

### B2. Trong khi đánh giá — Thực hiện

**B2.1 — Bằng chứng không chỉ là ảnh**

`finding_images` chỉ nhận ảnh. Thực tế cần thêm:

- **File tài liệu** (PDF/Word/Excel): bản scan quy trình, hồ sơ hiệu chuẩn, biên bản.
- **Ghi âm phỏng vấn** (kèm cảnh báo xin phép người được phỏng vấn) + tự chuyển thành văn bản.
- **Metadata ảnh**: thời gian chụp, vị trí GPS — tăng độ tin cậy của bằng chứng.
- Nên đổi tên bảng thành `finding_attachments` với cột `kind` để mở rộng về sau.

**B2.2 — Sổ tay ghi chép nhanh (audit notes)**

Không phải quan sát nào cũng thành finding. Auditor cần chỗ ghi nhanh những mẩu rời rạc trong ngày, rồi cuối buổi mới gom lại thành finding. Hiện muốn ghi gì cũng phải mở form finding đầy đủ.

Đề xuất: ô ghi chú tự do theo đơn vị/phiên, một nút "Chuyển thành finding".

**B2.3 — Ghi nhận cỡ mẫu (sampling)**

Phát biểu finding chuẩn cần "kiểm tra 8 hồ sơ, 3 hồ sơ sai". Hiện auditor phải tự nhớ gõ vào phần văn bản thô. Nên có hai ô riêng `sample_size` / `defect_count`, vừa đưa vào prompt cho AI, vừa xuất ra báo cáo, vừa dùng để đánh giá NC đơn lẻ hay có hệ thống (tiêu chí phân biệt Minor với Major).

**B2.4 — Chế độ ngoại tuyến (PWA)**

Như đã nêu ở A4. Kỹ thuật: `next-pwa` + hàng đợi ghi trong IndexedDB + chỉ báo "3 finding chờ đồng bộ". Việc chuẩn hoá bằng AI có thể hoãn tới khi có mạng — phần ghi nhận thô mới là phần không được phép mất.

**B2.5 — Biên bản họp khai mạc / kết thúc**

Schema đã có `session_kind: OPENING | CLOSING` cho lịch, nhưng chưa có nội dung họp:

- Danh sách tham dự (ký điện tử hoặc tick tên) — hồ sơ bắt buộc theo ISO 19011 §6.4.3.
- Nội dung trao đổi, cam kết của đơn vị.
- Ở họp kết thúc: trình bày danh sách finding, ghi nhận **ý kiến phản hồi / không đồng ý của đơn vị** — hiện app hoàn toàn không có kênh cho bên được đánh giá lên tiếng.

**B2.6 — Đồng bộ thời gian thực trong đoàn**

Trưởng đoàn hiện phải tải lại trang mới biết ai đã nộp gì. Với đoàn 5–8 người chạy song song, một màn hình "đang diễn ra" cập nhật liên tục (số finding theo đơn vị, ai đang ở đâu) sẽ giúp điều phối trong ngày.

---

### B3. Sau đánh giá — Báo cáo & theo dõi khắc phục

**⭐⭐ B3.1 — Theo dõi hành động khắc phục (CAPA) — chức năng thiếu quan trọng nhất**

Hiện app dừng lại ở chỗ **phát hiện vấn đề**. Nhưng ISO 9001 §10.2 quy định rõ khi có sự không phù hợp, tổ chức phải: ứng phó và khắc phục · đánh giá nhu cầu loại bỏ nguyên nhân (**phân tích nguyên nhân gốc**, xem xét NC tương tự đã/có thể xảy ra) · thực hiện hành động · **xem xét hiệu lực** của hành động đã thực hiện · cập nhật rủi ro và cơ hội · và **lưu hồ sơ về bản chất NC, hành động đã thực hiện và kết quả**.

App có `due_date` và trạng thái `CLOSED`, nhưng **không có gì để đóng finding một cách có căn cứ**. Hiện trưởng đoàn chỉ có thể bấm chuyển trạng thái — không hồ sơ, không bằng chứng, không ai chịu trách nhiệm.

Cần một thực thể `corrective_actions` gắn với finding:

| Trường | Ý nghĩa |
|---|---|
| `immediate_action` | Khắc phục tức thời (xử lý hậu quả) |
| `root_cause` | Phân tích nguyên nhân gốc — kèm công cụ 5 Why / xương cá |
| `similar_nc_review` | Đã xem xét NC tương tự ở nơi khác chưa (§10.2.1 b3) |
| `action_plan` | Hành động khắc phục (loại bỏ nguyên nhân) |
| `responsible_person`, `target_date` | Ai làm, hạn nào |
| `evidence_of_completion` | Bằng chứng đã làm (file/ảnh) |
| `verified_by`, `verified_at`, `effectiveness_verdict` | **Auditor xác nhận hiệu lực** — chỉ khi đạt mới đóng được finding |
| `system_change_needed` | Có phải sửa quy trình/HTQL không (§10.2.1 f) |

Kèm theo:

- **Cổng riêng cho đơn vị được đánh giá** — họ nhập kế hoạch khắc phục và tải bằng chứng lên. Hiện đơn vị hoàn toàn nằm ngoài app; trưởng đoàn phải gom qua email/Zalo rồi gõ lại.
- **Nhắc hạn tự động**: còn 7 ngày · đến hạn · quá hạn. Đây chính là tính năng khiến app được dùng *sau* tuần đánh giá, thay vì bị bỏ quên.
- **Không cho đóng finding** nếu chưa có xác nhận hiệu lực — chặn ở tầng API, không chỉ ở UI.
- Nếu cùng một nguyên nhân lặp lại ở kỳ sau → tự động gợi ý nâng lên **Major** (đúng tiêu chí đã ghi trong `SYSTEM_PROMPT` mục 6).

**⭐ B3.2 — Báo cáo đánh giá nội bộ hoàn chỉnh (Word)**

`xuat-word` hiện chỉ sinh **Chương trình đánh giá** (kế hoạch). `xuat-excel` sinh danh sách finding. **Chưa có báo cáo kết quả đánh giá** — tài liệu chính thức mà trưởng đoàn phải trình lãnh đạo.

Cần một file Word đầy đủ: thông tin đợt → mục tiêu/phạm vi/chuẩn mực → thành phần đoàn → tóm tắt kết quả (biểu đồ số finding theo đơn vị và theo mức độ) → **kết luận về mức độ phù hợp và hiệu lực của HTQL** (phần này AI hỗ trợ soạn được) → chi tiết từng finding kèm ảnh → khuyến nghị → khối ký duyệt.

**B3.3 — Phiếu yêu cầu hành động khắc phục (CAR) từng finding**

Một trang một finding, in ra gửi đơn vị ký nhận: mô tả NC · điều khoản vi phạm · bằng chứng (kèm ảnh) · phần trống cho đơn vị điền nguyên nhân và kế hoạch · khối ký ba bên. Đây là biểu mẫu dùng hằng ngày trong thực tế mà hiện app chưa sinh được.

**B3.4 — Gói dữ liệu đầu vào cho Xem xét của lãnh đạo (§9.3)**

ISO 9001 §9.3.2 c2 liệt kê "kết quả đánh giá" là đầu vào bắt buộc của xem xét lãnh đạo. Một nút "Xuất gói xem xét lãnh đạo" tổng hợp: kết quả tất cả các đợt trong kỳ · tình trạng hành động khắc phục · NC lặp lại · xu hướng theo điều khoản · mức độ hoàn thành chương trình đánh giá năm. Rất ít công để làm, tiết kiệm cho người phụ trách ISO cả buổi.

**B3.5 — Thông báo tự động**

Hiện việc gửi mã và nhắc hạn đều làm thủ công qua Zalo. Nên có email (Resend/SES) hoặc Zalo OA cho: gửi mã vào đợt · thông báo đợt sắp diễn ra · gửi finding cho đơn vị sau họp kết thúc · nhắc hạn khắc phục · thông báo quá hạn cho lãnh đạo.

---

### B4. Cấp chương trình — Phân tích nhiều kỳ

Những tính năng này chỉ chạy được sau khi có master data (B1.2), nhưng đây là chỗ app tạo ra giá trị mà file Excel không làm được:

- **Xu hướng theo thời gian**: số NC theo quý, theo đơn vị, theo điều khoản.
- **Điều khoản hay bị vi phạm nhất** toàn tổ chức → chỉ ra chỗ hệ thống yếu thật sự, chứ không phải chỗ đơn vị xui.
- **NC lặp lại** — cùng đơn vị, cùng điều khoản, xuất hiện lại sau khi đã đóng. Tự động đánh dấu và đề xuất nâng mức.
- **Bảng điểm đơn vị** (dùng thận trọng — dễ biến audit thành cuộc thi đua và khiến đơn vị giấu vấn đề).
- **Tỉ lệ đóng đúng hạn** — chỉ số sức khoẻ thật của HTQL.
- **Bản đồ nhiệt phủ điều khoản** qua các năm: điều khoản nào ba năm chưa ai đánh giá.

---

### B5. Mở rộng khả năng của AI

Phần AI hiện làm rất tốt đúng một việc: chuẩn hoá một finding. Có thể mở rộng theo hướng vẫn giữ nguyên tắc "AI là trợ lý, không phải người quyết định":

| Chức năng | Mô tả |
|---|---|
| **Rà soát chéo trước khi phát hành** | Đọc toàn bộ finding của đợt, chỉ ra: hai finding trùng nội dung · mức độ không nhất quán giữa các đơn vị cho cùng một vấn đề · finding thiếu bằng chứng kiểm chứng được. Chạy một lần cho cả đợt, tiết kiệm cho trưởng đoàn hàng giờ. |
| **Gợi ý câu hỏi checklist** | Từ điều khoản + đặc thù đơn vị, sinh bộ câu hỏi phỏng vấn cho B1.4. |
| **Trợ giúp phân tích nguyên nhân gốc** | Không tự kết luận, mà đặt câu hỏi 5-Why dẫn dắt đơn vị — giữ đúng nguyên tắc auditor không đề xuất giải pháp. |
| **Soạn kết luận báo cáo** | Từ toàn bộ finding, soạn nháp phần nhận định chung về hiệu lực HTQL cho B3.2. |
| **Đánh giá tính đầy đủ của bằng chứng khắc phục** | Đơn vị nộp bằng chứng đóng NC → AI đối chiếu với nội dung finding, chỉ ra chỗ chưa khớp. |
| **Tìm kiếm ngữ nghĩa toàn bộ lịch sử** | "Những finding nào liên quan đến hiệu chuẩn thiết bị đo?" — cần embedding, `pgvector` trên Neon là sẵn có. |

Một lưu ý: `MAX_IMAGES = 6` và tối đa 10 ảnh mỗi lần upload. Nếu auditor chụp 15 ảnh cho một vấn đề thì 9 ảnh cuối bị AI bỏ qua **mà không có cảnh báo rõ ràng trên UI** (chỉ có warning "ảnh không đọc được", không phải "ảnh vượt giới hạn"). Nên hiện thông báo rõ hoặc cho chọn ảnh nào đưa vào phân tích.

---

## PHẦN C — LỘ TRÌNH ĐỀ XUẤT

Xếp theo tỉ lệ **giá trị / công sức**, không phải theo độ hay ho.

### Đợt 1 — Vá lỗ hổng (1 tuần, làm trước khi cho người thật dùng)

1. ~~Xác thực cho `/api/standardize`~~ ✅ *(A1.1 — xong)* · còn `/api/uploads/presign` *(A1.2)*
2. Khoá thử sai mã 6 số *(A1.3)*
3. Soft-delete finding + bắt buộc nhập lý do xoá *(A2.1)*
4. Fail-fast khi thiếu `AUTH_SECRET` *(A3)* — tránh mất nửa ngày dò lỗi lúc deploy

### Đợt 2 — Đóng vòng lặp audit (3–4 tuần, giá trị nghiệp vụ cao nhất)

5. **Theo dõi hành động khắc phục CAPA** *(B3.1)* — quan trọng nhất trong toàn bộ tài liệu này
6. **Báo cáo đánh giá nội bộ bản Word** *(B3.2)* + phiếu CAR *(B3.3)*
7. Hiển thị lịch sử chỉnh sửa + nhật ký hành động đợt *(A2.2, A2.3)*
8. Nhắc hạn khắc phục qua email *(B3.5, phần tối thiểu)*

### Đợt 3 — Nâng chất công việc hiện trường (3–4 tuần)

9. Checklist theo điều khoản + thanh phủ điều khoản *(B1.4)*
10. Chế độ ngoại tuyến PWA *(B2.4)* + nhập bằng giọng nói *(A4)*
11. Đính kèm tài liệu, không chỉ ảnh *(B2.1)*; ô cỡ mẫu *(B2.3)*
12. Biên bản họp khai mạc/kết thúc + ý kiến phản hồi của đơn vị *(B2.5)*

### Đợt 4 — Lên cấp chương trình (4–6 tuần)

13. Master data đơn vị & đánh giá viên *(B1.2)* — điều kiện cần cho mọi thứ bên dưới
14. Chương trình đánh giá năm + ma trận phủ *(B1.1)*
15. Mô hình tổ chức & phân quyền theo vai trò *(A2.4)*
16. Bảng phân tích xu hướng nhiều kỳ *(B4)*
17. Hồ sơ năng lực & tuyên bố độc lập *(B1.3)*

### Xuyên suốt

- Viết test cho `lib/plan.ts` và `lib/assign.ts` *(A3)* — làm ngay khi bắt đầu Đợt 2, trước khi codebase lớn thêm.
- Cập nhật README sau mỗi đợt.

---

## Ba câu chốt

1. **Chỗ mạnh nhất của app là phần AI chuẩn hoá finding** — làm chín hơn hẳn mặt bằng, đừng sửa lung tung.
2. **Chỗ thiếu quan trọng nhất là theo dõi hành động khắc phục.** Một app đánh giá nội bộ dừng ở việc ghi nhận vấn đề mới chỉ làm được nửa việc; nửa còn lại — chứng minh vấn đề đã được xử lý và xử lý có hiệu lực — mới là thứ ISO 9001 §10.2 đòi hỏi và cũng là thứ khiến app được mở ra hằng tuần thay vì mỗi năm hai lần.
3. **Chỗ rủi ro nhất là xoá finding không để lại dấu vết.** Với một công cụ có mục đích tạo hồ sơ chứng cứ, đây là lỗi cần sửa trước cả các lỗ hổng bảo mật.
