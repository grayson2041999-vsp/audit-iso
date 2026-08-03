# Concept mở rộng — Quản lý đợt đánh giá nội bộ

Bản thiết kế để duyệt trước khi viết code. Mọi quyết định dưới đây bám theo lựa chọn
đã chốt: mã 6 số là đủ, trưởng đoàn dùng tài khoản, đơn vị và đánh giá viên tạo mới
theo từng đợt, xuất Excel, trưởng đoàn kiêm cả hai vai trò.

---

## 1. Ba vai trò

| Vai trò | Cách vào | Làm được gì |
|---|---|---|
| **Trưởng đoàn** | Tài khoản email + mật khẩu | Tạo đợt, tạo đơn vị, tạo đánh giá viên, phân công, sinh mã, xem tổng hợp, sửa mọi finding, khoá đợt, xuất Excel |
| **Đánh giá viên** | Bấm tên mình → nhập mã 6 số | Xem đơn vị được giao, ghi nhận finding, sửa finding của mình cho tới khi nộp |
| **Trưởng đoàn kiêm đánh giá viên** | Cùng tài khoản, chuyển giao diện | Cả hai, có nút chuyển qua lại |

---

## 2. Luồng đi qua app

```
TRƯỞNG ĐOÀN                                    ĐÁNH GIÁ VIÊN
─────────────────────────────────────────────────────────────────────
Đăng ký / Đăng nhập
        │
        ▼
Tạo đợt đánh giá
  · Tên đợt
  · Thời gian (chọn khoảng ngày trên lịch)
  · Trưởng đoàn (tự điền từ tài khoản)
  · Tiêu chuẩn áp dụng (9001 / 14001 / 45001)
        │
        ▼
Bước 1 — Tạo danh sách đơn vị được đánh giá
        │
        ▼
Bước 2 — Tạo danh sách đánh giá viên
  (tự thêm mình vào nếu cũng đi đánh giá)
        │
        ▼
Bước 3 — Phân công (ma trận tick: đơn vị × đánh giá viên)
  · 1 đánh giá viên ↔ nhiều đơn vị
  · 1 đơn vị ↔ nhiều đánh giá viên
  · Nút "Sinh mã & mở đợt" chỉ bật khi MỌI đơn vị
    đã có ít nhất một đánh giá viên
        │
        ▼
Sinh mã 6 số cho từng đánh giá viên  ──── gửi link đợt + mã ────►  Mở link đợt
  · Bảng mã luôn xem lại được                                          │
    (đánh giá viên quên thì hỏi)                                       ▼
        │                                                    Bấm tên mình → nhập mã
        │                                                              │
        │                                                              ▼
        │                                                    Thấy các đơn vị được giao
        │                                                              │
        │                                                              ▼
        │                                                    Ghi nhận finding
        │                                                    (AI chuẩn hoá như hiện tại)
        │                                                              │
        │                                                              ▼
        │                                                    Lưu nháp ⇄ sửa tự do
        │                                                              │
        │                                                              ▼
        ▼                                                        Bấm NỘP
Bảng tổng hợp finding toàn bộ đơn vị  ◄───────────────────────  (hết quyền sửa)
  · Lọc theo đơn vị / đánh giá viên / mức độ / trạng thái
  · Sửa được finding của bất kỳ ai
  · Xuất Excel
        │
        ▼
Khoá đợt (không ai nhập/sửa được nữa)
```

---

## 3. Trạng thái

### Đợt đánh giá

Không cần nút bật/tắt riêng — trạng thái suy ra từ hành động, đúng như bạn nhận xét:
phân công xong mới sinh mã nên không lo đánh giá viên nhập sớm.

| Trạng thái | Khi nào | Đánh giá viên vào được? |
|---|---|---|
| **Đang chuẩn bị** | Chưa sinh mã | Không (chưa có mã) |
| **Đang thực hiện** | Đã sinh mã | Có |
| **Đã khoá** | Trưởng đoàn bấm khoá | Xem được, không sửa |

### Finding

| Trạng thái | Ai sửa được |
|---|---|
| **Nháp** | Đánh giá viên tạo ra nó, và trưởng đoàn |
| **Đã nộp** | Chỉ trưởng đoàn |
| **Đã duyệt** | Chỉ trưởng đoàn |

Bỏ hai trạng thái cũ `AI_DRAFTED` và `ISSUED` — không còn ý nghĩa trong luồng mới.

---

## 4. Cấu trúc dữ liệu

### Bảng mới

**`leaders`** — tài khoản trưởng đoàn
```
id · email (duy nhất) · password_hash · full_name · created_at
```

**`audit_units`** — đơn vị được đánh giá, thuộc về một đợt
```
id · audit_id · name · note · created_at
```

**`audit_members`** — đánh giá viên, thuộc về một đợt
```
id · audit_id · full_name · home_unit · access_code (6 số) · is_leader · created_at
```
`home_unit` là đơn vị công tác của họ, dùng để cảnh báo khi phân công vào chính
đơn vị mình. Không bắt buộc nhập.

**`assignments`** — phân công nhiều–nhiều
```
id · audit_id · member_id · unit_id      (duy nhất theo cặp member+unit)
```

### Bảng sửa

**`audits`** — thêm `leader_id` và `finding_seq` (bộ đếm sinh mã, xem mục 8b),
bỏ cột `auditee` (giờ đã có bảng `audit_units`)

**`findings`** — thêm:
```
unit_id    → đơn vị được đánh giá (thay cho ô gõ tay `auditee`)
member_id  → ai ghi nhận (thay cho ô gõ tay `auditor_name`)
submitted_at
```

Cột `auditee` và `auditor_name` dạng chữ vẫn giữ lại cho các finding cũ đã lưu.

---

## 5. Form ghi nhận gọn đi rõ rệt

Hai ô biến mất vì hệ thống đã biết:

- **Đơn vị được đánh giá** — đánh giá viên vào từ trang của đơn vị nào thì finding
  thuộc đơn vị đó. Hết chuyện gõ sai chính tả tên đơn vị làm hỏng thống kê.
- **Auditor** — đã biết ai đăng nhập.

Còn lại: Tiêu chuẩn · Nội dung ghi nhận · Nơi phát hiện · Hình ảnh, rồi phần AI chuẩn hoá.

Tiêu chuẩn áp dụng có thể lấy mặc định từ đợt đánh giá, đánh giá viên chỉ chỉnh khi cần.

---

## 6. Xuất Excel

Một dòng một finding, cột đúng theo báo cáo:

```
STT · Mã finding · Đơn vị được đánh giá · Nơi phát hiện · Phân loại ·
Điều khoản · Mô tả phát hiện · Bằng chứng · Thời hạn khắc phục ·
Đánh giá viên · Trạng thái
```

Kèm một sheet tổng hợp đếm số finding theo đơn vị và theo mức độ.

---

## 7. Những chỗ tôi biết là đang đánh đổi

Ghi lại để sau này không ai hiểu nhầm là sơ suất.

**Mã 6 số lưu ở dạng đọc được.** Bắt buộc phải vậy thì trưởng đoàn mới tra lại được
cho người quên mã. Nghĩa là ai truy cập được database sẽ thấy toàn bộ mã. Chấp nhận
theo quyết định "tạm thời chưa cần cao về bảo mật".

**Không giới hạn số lần nhập sai mã.** Danh sách tên đánh giá viên hiển thị công khai
trên trang đợt, nên về lý thuyết có thể dò mã. Nếu sau này đưa vào dùng chính thức
với dữ liệu nhạy cảm, đây là chỗ cần sửa đầu tiên — thêm khoá tạm sau 5 lần sai là đủ.

**Đơn vị và đánh giá viên nhập lại mỗi đợt.** Bạn chọn linh hoạt hơn dùng chung danh mục.
Đổi lại, tên đơn vị gõ khác nhau giữa các đợt sẽ không so sánh được theo thời gian
("Phòng Kỹ thuật" và "P. Kỹ thuật" thành hai đơn vị khác nhau). Khi nào cần thống kê
nhiều năm thì tính tiếp.

**Ai cũng đăng ký được tài khoản trưởng đoàn.** Chưa có duyệt. Với app nội bộ dùng
trong phạm vi hẹp thì ổn.

---

## 8. Hai điểm đã chốt

### a. Đánh giá viên vào đợt bằng đường link

Trưởng đoàn copy đường link của đợt rồi gửi cho cả đoàn qua Zalo/email. Mở link là
thấy ngay danh sách tên. Không có trang tra cứu, không phải nhớ mã đợt.

### b. Mã finding trung tính: `F-01`, `F-02`, …

Đánh số liên tục trong phạm vi một đợt, **không mang tiền tố theo mức độ**.

Lý do không dùng `NC-` / `OBS-` / `OFI-`: mức độ có thể thay đổi khi trưởng đoàn rà
soát. Một Minor bị hạ xuống Observation sẽ buộc `NC-05` phải đổi thành `OBS-05`, trong
khi mã cũ có thể đã được nhắc trong biên bản họp, email gửi đơn vị, phiếu yêu cầu khắc
phục. **Mã định danh không được chứa thông tin có thể thay đổi.**

Không mất mát gì: cột Phân loại nằm ngay cạnh cột Mã trong mọi bảng và trong file Excel.

### Chống trùng mã khi nhiều người lưu cùng lúc

Không được sinh mã bằng cách đếm số finding hiện có rồi cộng một — hai đánh giá viên
bấm Lưu cùng lúc sẽ cùng đọc ra "đang có 4" và cùng tạo `F-05`.

Cách làm đúng: đặt cột đếm `finding_seq` trên bảng `audits`, mỗi lần lưu chạy đúng một
câu lệnh nguyên tử:

```sql
UPDATE audits SET finding_seq = finding_seq + 1 WHERE id = $1 RETURNING finding_seq;
```

Postgres khoá dòng trong lúc thực hiện, nên hai người đồng thời sẽ nhận 5 và 6. Kèm
ràng buộc duy nhất trên cặp `(audit_id, code)` làm lưới an toàn.

Đánh đổi: nếu việc lưu thất bại sau khi đã lấy số, mã đó bị bỏ trống và báo cáo nhảy
từ `F-04` sang `F-06`. Không ảnh hưởng, vì file Excel đánh lại **STT liên tục** ở cột
đầu — mã finding chỉ đóng vai trò định danh cố định.
