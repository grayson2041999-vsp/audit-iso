'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Counts = {
  units: number;
  members: number;
  findings: number;
  images: number;
};

/** So chuỗi bỏ qua khoảng trắng thừa và hoa thường — khớp với kiểm tra ở máy chủ. */
const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Vùng nguy hiểm — xoá vĩnh viễn đợt đánh giá.
 *
 * Bắt gõ lại đúng tên đợt thay vì chỉ bấm "Đồng ý": hộp thoại xác nhận thông
 * thường bị bấm qua theo phản xạ, còn việc phải gõ lại buộc người dùng đọc tên
 * và ý thức được mình đang xoá cái nào.
 */
export function DeleteAuditBox({
  auditId, auditTitle, counts,
}: {
  auditId: string;
  auditTitle: string;
  counts: Counts;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matched = norm(value) === norm(auditTitle);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/audits/${auditId}/xoa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Không xoá được.');
      router.push('/quan-ly');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lỗi không xác định.');
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-red-200 bg-white p-5">
      <h2 className="font-semibold text-red-700">Vùng nguy hiểm</h2>
      <p className="mb-4 mt-1 text-sm text-slate-500">
        Xoá vĩnh viễn đợt đánh giá này cùng toàn bộ dữ liệu bên trong. Không khôi phục lại được.
      </p>

      {!open ? (
        <button
          onClick={() => {
            setOpen(true);
            setValue('');
            setError(null);
          }}
          className="btn-ghost !border-red-300 !text-red-700 hover:!bg-red-50"
        >
          Xoá đợt đánh giá
        </button>
      ) : (
        <div className="rounded-lg border border-red-200 bg-red-50/60 p-4">
          <p className="text-sm font-medium text-red-900">Những thứ sau sẽ mất vĩnh viễn:</p>
          <ul className="mt-2 space-y-1 text-sm text-red-800">
            <li>• {counts.findings} finding (kể cả bản đã nộp và đã rà soát)</li>
            <li>• {counts.images} ảnh hiện trường trên Cloudflare R2</li>
            <li>• {counts.units} đơn vị được đánh giá và {counts.members} đánh giá viên</li>
            <li>• Toàn bộ phân công, mã truy cập và lịch sử chỉnh sửa</li>
          </ul>

          {counts.findings > 0 && (
            <p className="mt-3 rounded-lg bg-white px-3 py-2 text-sm text-slate-700">
              Nếu chỉ muốn dừng đợt lại, hãy <strong>khoá đợt</strong> ở tab Tổng hợp finding
              thay vì xoá — dữ liệu vẫn còn để tra cứu về sau. Cân nhắc xuất Excel trước khi xoá.
            </p>
          )}

          <label className="label mt-4">
            Gõ lại chính xác tên đợt để xác nhận:
          </label>
          <p className="mb-2 rounded bg-white px-3 py-2 text-sm font-medium text-slate-800">
            {auditTitle}
          </p>
          <input
            autoFocus
            className="input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Nhập lại tên đợt đánh giá"
          />

          {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={remove}
              disabled={!matched || busy}
              className="btn inline-flex bg-red-600 text-white hover:bg-red-700"
            >
              {busy ? 'Đang xoá…' : 'Tôi hiểu hậu quả, xoá đợt này'}
            </button>
            <button
              onClick={() => {
                setOpen(false);
                setValue('');
                setError(null);
              }}
              disabled={busy}
              className="btn-ghost"
            >
              Huỷ
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
