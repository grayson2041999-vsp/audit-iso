# Concept — AI sinh checklist đánh giá cho đánh giá viên

> **Trạng thái: đã triển khai xong.**
> Ứng với mục **B1.4** trong `docs/ra-soat-va-de-xuat.md`, nhưng **thu hẹp phạm vi có chủ đích**:
> đây là một tờ giấy tham khảo, không phải một quy trình mới trong app.

---

## 1. Nó là cái gì — và không là cái gì

Đánh giá viên vào làm việc với một đơn vị, phỏng vấn về chức năng nhiệm vụ hoặc xin quy chế
hoạt động, nhập vào app. AI đọc thông tin đó, biết đợt này đánh giá những tiêu chuẩn nào,
rồi sinh ra một **danh mục công việc cần làm** để đánh giá viên có cái bám vào trong buổi
làm việc. Xuất ra file Word — xem trên máy hoặc in ra cầm tay.

**Có chủ đích KHÔNG làm trong bản này:**

| Không làm | Vì sao |
|---|---|
| Tick trạng thái từng dòng trong app | Đánh giá viên tick trên giấy hoặc trên file Word của mình. Bắt nhập lại vào app là thêm việc, không thêm giá trị. |
| Chuyển dòng "không phù hợp" thành finding | Màn hình ghi nhận finding đã có sẵn và đủ nhanh. Nối hai thứ lại chỉ có nghĩa khi checklist sống trong DB. |
| Thanh phủ điều khoản ("đã xem 12/18") | Checklist này **không phải cam kết phải làm hết**. Đo độ phủ trên một danh mục tham khảo là đo sai thứ. |
| Lưu checklist vào cơ sở dữ liệu | Sinh xong tải Word là xong. Xem mục 8 về đánh đổi. |
| Trưởng đoàn duyệt checklist trước khi dùng | Đây là công cụ cá nhân của đánh giá viên, không phải hồ sơ của đợt. |

Ranh giới này quan trọng: nó giữ tính năng ở mức **một màn hình + một route + một hàm dựng
Word**, không đụng tới schema.

---

## 2. Luồng

```
Đánh giá viên → trang đơn vị được giao  /dot/[id]/don-vi/[unitId]
        │
        ▼
Bấm "Checklist đánh giá"
        │
        ▼
Ô nhập: chức năng, nhiệm vụ / quy chế hoạt động của đơn vị
  (gõ tay hoặc dán vào — xem mục 3)
        │
        ▼
POST /api/dot/[id]/don-vi/[unitId]/checklist     ← NDJSON chảy dần, như /api/standardize
  ├─ nạp danh mục điều khoản của các tiêu chuẩn đợt đang áp dụng
  ├─ nạp bối cảnh đợt: tổ chức, mục tiêu, chuẩn mực, thời lượng phiên
  └─ gọi Claude → Zod validate → hậu kiểm mã điều khoản
        │
        ▼
Xem trước trên màn hình — sửa chữ, xoá dòng, thêm dòng tự viết
        │
        ▼
Bấm "Tải file Word"  →  POST .../checklist/xuat-word  →  .docx
```

Việc **xem trước và sửa được trước khi tải** là bắt buộc, không phải tuỳ chọn. Vì không lưu
vào DB, file Word là bản duy nhất — sai chữ nào thì phải sửa trước khi tải, không có đường
quay lại ngoài sinh lại từ đầu.

---

## 3. Đầu vào

**Bản này: một ô text tự do.** Đánh giá viên gõ tóm tắt hoặc dán nội dung quy chế vào.
Không upload file — R2 hiện chỉ dùng cho ảnh, và đọc PDF/Word là một khối việc riêng
(trùng với B2.1 `finding_attachments`, nên làm chung khi tới lượt nó).

Ngoài ô text đó, hệ thống **tự lấy sẵn** những thứ đã có, đánh giá viên không phải nhập lại:

| Dữ liệu | Lấy từ |
|---|---|
| Tiêu chuẩn áp dụng | `audits.standards` |
| Tổ chức được đánh giá | `audits.organization` |
| Mục tiêu, chuẩn mực đánh giá | `audits.objectives`, `audits.criteria` |
| Tên đơn vị, ghi chú đơn vị | `audit_units.name`, `.note` |
| Đánh giá viên | phiên đăng nhập (`member-auth`) |
| Thời lượng phiên làm việc với đơn vị | `audit_sessions.startTime/endTime` (phiên `UNIT` của đơn vị này) |

Thời lượng phiên dùng để **định cỡ checklist**, xem mục 4.

---

## 4. Bốn quy tắc quyết định chất lượng đầu ra

### a. Định cỡ theo thời lượng, không sinh cho hết điều khoản

Ba tiêu chuẩn cộng lại có hơn 130 điều khoản trong `lib/iso.ts`. Sinh câu cho tất cả thì
ra tờ giấy không ai đọc. Trần theo thời lượng phiên, quy đổi **khoảng 3 phút một dòng**:

| Phiên | Số dòng |
|---|---|
| 60 phút | 18–22 |
| 90 phút | 25–30 |
| 120 phút | 32–40 |

Không có phiên trong lịch thì mặc định 25 dòng.

### b. Chỉ lấy điều khoản áp dụng ở CẤP ĐƠN VỊ

Đây là bộ lọc làm cho checklist thực sự dùng được.

- **Đưa vào** — điều khoản mà một phòng/ban/xưởng chịu trách nhiệm thực hiện:
  7.1.3–7.1.6, 7.2, 7.3, 7.4, 7.5.2, 7.5.3, 8.x (theo quá trình đơn vị làm), 9.1.1, 10.2.
  Với 14001 thêm 6.1.2 khía cạnh môi trường, 8.2 ứng phó khẩn cấp;
  với 45001 thêm 5.4 tham vấn người lao động, 6.1.2 nhận diện mối nguy, 8.1.2–8.1.4, 8.2.
- **Loại ra** — điều khoản cấp hệ thống, hỏi ở lãnh đạo/QMR chứ không hỏi phòng ban:
  4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 6.2, 6.3, 9.2, 9.3, 10.1, 10.3.

Trừ khi thông tin đầu vào cho thấy đơn vị **chính là** bộ phận giữ hệ thống (ban ISO, phòng
quản lý chất lượng) — khi đó đảo lại.

### c. Gộp điều khoản trùng giữa ba tiêu chuẩn — một dòng, nhiều mã

Đây là điểm khiến app phục vụ được hệ thống **tích hợp** thay vì ba hệ thống rời.

7.2 năng lực, 7.3 nhận thức, 7.4 trao đổi thông tin, 7.5 thông tin dạng văn bản, 10.2 khắc
phục — nội dung gần trùng ở cả 9001/14001/45001. Sinh riêng theo từng tiêu chuẩn thì cùng
một công việc lặp ba lần trên giấy và đánh giá viên hỏi đơn vị ba lần cùng một câu.

**Một dòng gắn nhiều mã.** Chỉ tách riêng phần đặc thù thật sự: khía cạnh môi trường và
nghĩa vụ tuân thủ của 14001, nhận diện mối nguy và tham vấn người lao động của 45001,
kiểm soát đầu ra không phù hợp của 9001.

### d. Viết dạng hành động, không viết dạng câu hỏi đóng

Tên cột đã là "Công việc cần làm" — chữ trong cột phải theo đúng tên đó.

| | |
|---|---|
| ✗ Kém | "Đơn vị có kiểm soát hồ sơ đào tạo không?" |
| | Đơn vị trả lời "Có" là hết chuyện. Không kiểm chứng được gì. |
| ✓ Được | "Xin danh sách nhân sự và hồ sơ đào tạo năm 2026; chọn 3 người đối chiếu với yêu cầu năng lực của vị trí." |
| | Có việc để làm, có hồ sơ để xem, có cỡ mẫu, có cái để đối chiếu. |

Mỗi dòng nên chứa đủ ba phần: **làm gì – xem hồ sơ nào – đối chiếu với yêu cầu nào**.
Dùng động từ: *xin, yêu cầu xuất trình, chọn ngẫu nhiên, đối chiếu, quan sát tại chỗ, hỏi
người trực tiếp làm*.

Kèm hai ràng buộc lấy nguyên từ `SYSTEM_PROMPT` hiện có:

- **Không bịa số hiệu tài liệu, tên biểu mẫu, ngày tháng.** Chỉ được dẫn đích danh
  ("Thủ tục QT-05") khi thông tin đầu vào đã nêu. Không thì viết chung
  ("quy trình nội bộ đang áp dụng cho công việc này").
- **Chỉ dùng mã điều khoản có trong `lib/iso.ts`**, server hậu kiểm loại mã bịa —
  tái sử dụng đúng hàm đang dùng cho finding.

---

## 5. Sắp xếp: theo chủ đề công việc, không theo số điều khoản

Xếp từ điều 4 đến điều 10 thì buổi phỏng vấn nhảy chủ đề liên tục — hỏi tài liệu ở 7.5, đi
tiếp, rồi lại quay về tài liệu ở 8.5.2. Xếp theo mạch công việc thì đánh giá viên đi một
mạch, và đơn vị cũng dễ theo.

Nhóm đề xuất, theo thứ tự trên giấy:

1. **Chức năng, nhiệm vụ và quá trình của đơn vị** — mở đầu, xác nhận lại phạm vi
2. **Nhân sự, năng lực và nhận thức**
3. **Tài liệu, hồ sơ đang sử dụng**
4. **Quá trình chính của đơn vị** — phần dài nhất, bám vào thông tin đầu vào
5. **An toàn và sức khoẻ tại nơi làm việc** — chỉ khi đợt có ISO 45001
6. **Môi trường và chất thải** — chỉ khi đợt có ISO 14001
7. **Theo dõi, đo lường và khắc phục** — gồm hiệu lực khắc phục kỳ trước

Nhóm 5 và 6 tự bỏ đi nếu tiêu chuẩn tương ứng không nằm trong `audits.standards`.
Mã điều khoản không thành cột riêng — đặt trong ngoặc cuối mỗi dòng, chữ nhỏ và nghiêng:
*(7.2 QMS/EMS/OHS)*. Vừa đủ để biết viện dẫn gì khi phát hiện vấn đề, vừa không chiếm chỗ.

---

## 6. File Word

**Khổ A4 dọc.** Bốn cột đúng như đã chốt:

| Cột | Bề rộng | Nội dung |
|---|---|---|
| STT | 720 twip (7%) | Đánh số liên tục qua các nhóm |
| Công việc cần làm | 4450 twip (44%) | Câu hành động + mã điều khoản trong ngoặc |
| *(không tên)* | 1010 twip (10%) | Cột đánh tích — ô vuông ☐ căn giữa. Không đặt tên cột: ô vuông đã tự nói lên công dụng, còn chữ "Đánh tích" không lọt một dòng trong 10% bề rộng nên làm hàng tiêu đề cao gấp đôi |
| Ghi chú | 3926 twip (39%) | Để trống, viết tay tại chỗ |

Chiều cao dòng tối thiểu ~1,2 cm để viết tay được, và **không cho một dòng bị cắt ngang
trang** (`cantSplit`) — dòng bị cắt thì nửa sau nằm ở trang mới mà không có số thứ tự.
Tên nhóm là một dòng gộp ô, nền xám, in đậm. Dòng tiêu đề lặp lại ở mỗi trang.

**Bề rộng cột phải đặt bằng twip kèm `layout: FIXED`, không đặt bằng phần trăm.** Đặt phần
trăm thì Word vẫn tự co giãn theo nội dung: cột STT chứa một hai chữ số mà phình ra bằng một
phần tư trang, còn cột "Công việc cần làm" bị bóp còn hơn hai mươi phần trăm, chữ rơi xuống
bảy tám dòng và tờ giấy dài gấp rưỡi cần thiết. Đây là lỗi đã mắc một lần rồi sửa, nên bốn
con số cộng đúng bằng 10106 twip nằm ngay trong `checklist-docx.ts` kèm chú thích.

**Đầu trang**, lấy sẵn từ dữ liệu đợt:

```
DANH MỤC CÔNG VIỆC ĐÁNH GIÁ
Tổ chức:            {audits.organization}
Đợt đánh giá:       {audits.title}
Đơn vị được đánh giá: {audit_units.name}
Tiêu chuẩn áp dụng:  ISO 9001:2015 · ISO 14001:2015 · ISO 45001:2018
Đánh giá viên:      {member.fullName}
Ngày: ......../......../20......
```

**Một dòng ghi chú in nghiêng ngay dưới đầu trang, trước bảng:**

> *Danh mục này do hệ thống gợi ý để đánh giá viên tham khảo. Không bắt buộc thực hiện hết
> các mục, và không giới hạn phạm vi đánh giá.*

Câu này không phải thủ tục thừa. Nó đúng tinh thần của tính năng, và trả lời sẵn cho người
sau này cầm tờ giấy lên hỏi tại sao có dòng bỏ trống.

**Cuối bảng: ba dòng trắng** đánh số tiếp, để đánh giá viên tự viết thêm việc phát sinh tại chỗ.

Font Times New Roman 12pt, dùng lại nguyên `p()`, `cell()`, `bullets()` trong
`src/app/api/audits/[id]/xuat-word/route.ts` — không viết lại khối dựng Word mới.

---

## 6b. Màn hình chờ

Soạn xong ba mươi dòng mất 30–60 giây — đủ lâu để người dùng nghi trang bị treo. Cách chữa
KHÔNG phải thanh chạy giả hay mấy câu "bạn có biết…" nhảy vòng; đánh giá viên đọc ra ngay
đó là đồ trang trí rồi mất tin vào phần còn lại của app.

Mọi thứ hiện trên màn hình chờ đều là việc thật:

| Hiện gì | Lấy từ đâu |
|---|---|
| **Dàn ý đủ bảy nhóm, ngay từ giây 0** | Sự kiện `meta` máy chủ gửi TRƯỚC khi gọi AI — nhóm suy từ `audits.standards`, số dòng suy từ thời lượng phiên |
| **Thanh tiến độ** | Số dòng đã viết ÷ trần số dòng. Tỉ lệ có thật, không phải hàm thời gian |
| **Nhóm đang viết, số dòng từng nhóm** | Đếm trực tiếp từ JSON đang chảy về |
| **Bản tóm tắt "AI hiểu đơn vị này như sau"** | `unitSummary` — trường model viết đầu tiên |
| **Câu vừa soạn xong, nguyên văn** | Phần tử cuối của nhóm cuối |

Thanh chốt ở **95%** cho tới khi thật sự xong: model hay viết lệch trần một hai dòng, và một
thanh đứng im ở 100% trong lúc vòng tròn vẫn quay là thứ khiến người dùng nghĩ nó hỏng.

Có nút **Huỷ** (`AbortController`). Chờ một phút mà không bỏ ngang được thì rất bí, và huỷ
giữa chừng không bị trừ lượt AI vì lượt chỉ ghi khi sự kiện `done` về tới.

Ô nhập mờ đi trong lúc chờ nhưng vẫn đọc được — cần thiết, vì nếu tóm tắt của AI cho thấy nó
hiểu sai thì đánh giá viên phải nhìn lại đúng chỗ mình viết thiếu.

---

## 7. Chạm vào những đâu trong mã nguồn

| File | Việc |
|---|---|
| `src/lib/checklist-prompt.ts` | **mới** — system prompt, `buildChecklistPrompt()`, 7 nhóm chủ đề, hàm định cỡ theo thời lượng |
| `src/lib/checklist-docx.ts` | **mới** — toàn bộ bố cục file Word, dựng được mà không cần DB hay phiên đăng nhập |
| `src/lib/iso.ts` | **thêm** — `UNIT_LEVEL_CLAUSES`, `clauseListByTier()`, `formatClauseRefs()` |
| `src/lib/types.ts` | **thêm** — Zod schema cho checklist, request sinh và request xuất Word |
| `src/lib/ai.ts` | **thêm** — `CHECKLIST_TOOL`, `generateChecklistStream()`, `finalizeChecklist()` |
| `src/lib/ai-quota.ts` | **sửa** — thêm loại `checklist`, bảng `WEIGHT` để một lần sinh tính bằng 3 lượt |
| `src/app/api/dot/[id]/don-vi/[unitId]/checklist/route.ts` | **mới** — NDJSON chảy dần, 5 cửa |
| `.../checklist/xuat-word/route.ts` | **mới** — kiểm quyền, đọc dữ liệu, gọi `buildChecklistDoc` |
| `src/components/ChecklistBuilder.tsx` | **mới** — ô nhập, màn hình chờ (mục 6b), bảng xem trước sửa được, nút tải |
| `src/app/dot/[id]/don-vi/[unitId]/checklist/page.tsx` | **mới** — trang chứa, kèm `loading.tsx` |
| `src/app/dot/[id]/don-vi/[unitId]/page.tsx` | **sửa** — thêm nút "Checklist đánh giá" |

**Không đụng tới `schema.ts`.** Không migration.

Bốn cửa của route sinh checklist giữ nguyên thứ tự đã dùng ở `/api/standardize`:
dữ liệu hợp lệ (400) → người gọi là ai (401) → đợt còn mở (409) → còn lượt AI (429).
Thêm một cửa nữa: đánh giá viên có được phân công đơn vị này không (`memberOwnsUnit`, 404).

**Quota:** đếm chung vào `ai_usage` như chuẩn hoá finding, nhưng **một lượt sinh checklist
tính bằng 3 lượt** (`WEIGHT` trong `ai-quota.ts` — ghi 3 dòng nhật ký thay vì 1). Đầu ra dài
gấp nhiều lần một finding. Với trần mặc định 20 lượt/giờ, đánh giá viên vẫn sinh được 6
checklist một giờ, thừa cho một ngày làm việc.

**Viện dẫn sai thì bỏ viện dẫn, giữ dòng công việc.** Khác cách xử lý của finding, nơi mất
hết điều khoản là mất luôn ý nghĩa nên phải cảnh báo gắt. Ở checklist, phần có giá trị nằm
trong cột "Công việc cần làm"; mã điều khoản chỉ là chú thích trong ngoặc. Vứt cả dòng đi vì
một mã sai là đổi thứ đáng giá lấy thứ không đáng.

---

## 8. Những chỗ biết là đang đánh đổi

**Không lưu checklist.** Đóng nhầm tab là mất, phải sinh lại và tốn thêm lượt AI. Chấp nhận,
vì lưu lại kéo theo cả một chuỗi câu hỏi không muốn trả lời lúc này: lưu bao lâu, ai xem
được, đợt khoá thì checklist có khoá không, sửa sau khi tải Word thì bản nào là bản đúng.
Bản Word tải về chính là bản lưu — nằm trên máy đánh giá viên.

Giảm nhẹ bằng hai việc rẻ tiền: giữ kết quả trong state của React nên bấm ra bấm vào trong
màn hình không mất, và cảnh báo `beforeunload` khi có checklist chưa tải.

**Chất lượng phụ thuộc hoàn toàn vào thông tin đầu vào.** Đánh giá viên gõ ba dòng thì
AI trả về checklist chung chung đúng ba dòng đó. Không có cách nào vòng qua. Nên đặt sẵn
gợi ý trong ô nhập (placeholder) nêu rõ nên gõ gì: chức năng nhiệm vụ, các quá trình chính,
có vận hành thiết bị/hoá chất/kho không, có tiếp xúc khách hàng không.

**Không dùng finding kỳ trước.** Nhóm 7 chỉ có dòng chung "kiểm tra hiệu lực khắc phục các
sự không phù hợp kỳ trước", không dẫn được finding cụ thể. Muốn dẫn đích danh thì cần ID
đơn vị ổn định qua các đợt — tức là phải trả nợ B1.2 (master data `org_units`) trước.
Ghi lại để sau này không ai tưởng là quên.

**Checklist do AI sinh dễ tạo cảm giác an toàn giả.** Đánh giá viên bám cứng vào tờ giấy sẽ
bỏ lỡ dấu hiệu tại hiện trường. Ba dòng trắng cuối bảng và câu ghi chú đầu trang là để chống
lại chuyện đó, nhưng chúng chỉ là lời nhắc — không thay được kinh nghiệm của người đi đánh giá.

---

## 9. Câu chốt

Tính năng này không thêm một quy trình nào vào app. Nó lấy những thứ app **đã biết** — đợt
này đánh giá theo tiêu chuẩn nào, đơn vị nào, ai đi đánh giá, phiên dài bao lâu — cộng với
một đoạn mô tả đơn vị, rồi trả về một tờ giấy. Giá trị nằm trọn trong chất lượng chữ ở cột
"Công việc cần làm". Mọi thứ khác trong tài liệu này chỉ là để tờ giấy đó ngắn, đúng chỗ,
và cầm được vào phòng họp.
