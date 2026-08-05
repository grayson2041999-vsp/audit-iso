'use client';

import { useEffect, useState } from 'react';
import { SEVERITY_LABELS } from '@/lib/iso';
import { SEVERITY_STYLE } from '@/lib/utils';
import type { StandardizedFinding } from '@/lib/types';

/**
 * Màn hình chờ trong lúc AI chuẩn hoá.
 *
 * Trước đây chỗ này tích dần các bước theo MỐC THỜI GIAN ƯỚC LƯỢNG — trình tự
 * thì đúng nhưng thời điểm chuyển bước là đoán, nên phải kèm một dòng ghi chú
 * thú nhận điều đó.
 *
 * Giờ nội dung chảy về thật, nên bỏ hết phần đoán: hiện đúng những gì model đã
 * viết xong, theo đúng thứ tự nó viết. Mức độ và tiêu đề ra trước, phát biểu
 * chảy dần từng chữ. Khung xương chỉ còn dùng cho khoảng lặng một hai giây đầu
 * lúc chưa có mẩu nào về.
 */
export function AnalysisProgress({
  hasImages,
  partial = null,
}: {
  hasImages: boolean;
  /**
   * Bản đang chảy về. Bỏ trống ở những đường không stream — ví dụ nút chuẩn hoá
   * lại cho finding đã lưu, nơi máy chủ ghi thẳng vào database rồi mới trả lời.
   */
  partial?: Partial<StandardizedFinding> | null;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const slow = elapsed >= 60;
  const started = Boolean(partial && Object.keys(partial).length > 0);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <p className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
            {started
              ? 'AI đang viết'
              : hasImages
                ? 'AI đang đọc ghi nhận và hình ảnh'
                : 'AI đang đọc ghi nhận'}
          </p>
          <span className="font-mono text-xs tabular-nums text-slate-500">
            {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
          </span>
        </div>

        {started ? (
          <div className="space-y-3">
            {partial?.severityRationale && (
              <Line label="Lập luận phân loại">{partial.severityRationale}</Line>
            )}

            {partial?.severity && (
              <div className="flex flex-wrap items-center gap-2">
                <span className={`chip ${SEVERITY_STYLE[partial.severity] ?? ''}`}>
                  {SEVERITY_LABELS[partial.severity] ?? partial.severity}
                </span>
                {partial.title && <span className="text-sm font-medium">{partial.title}</span>}
              </div>
            )}

            {partial?.statement && <Line label="Phát biểu">{partial.statement}</Line>}

            {partial?.clauses && partial.clauses.length > 0 && (
              <Line label="Điều khoản viện dẫn">
                {partial.clauses
                  .filter((c) => c?.clause)
                  .map((c) => `${c.standard ?? ''} ${c.clause}`.trim())
                  .join(' · ')}
              </Line>
            )}

            {partial?.evidence && partial.evidence.length > 0 && (
              <Line label="Bằng chứng">{partial.evidence.filter(Boolean).join(' · ')}</Line>
            )}
          </div>
        ) : (
          /* Khoảng lặng đầu tiên, chưa có mẩu nào về. */
          <div className="space-y-3" aria-hidden>
            <div className="h-4 w-2/3 animate-pulse rounded bg-slate-200" />
            <div className="h-4 w-1/3 animate-pulse rounded bg-slate-100" />
            <div className="h-16 animate-pulse rounded-lg bg-slate-100" />
          </div>
        )}
      </div>

      {slow && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Lâu hơn thường lệ. Ghi nhận dài hoặc nhiều ảnh sẽ mất thêm thời gian — cứ để yên, đừng
          bấm lại.
        </p>
      )}
    </div>
  );
}

/** Một dòng nội dung đang chảy về, kèm con trỏ nhấp nháy ở cuối. */
function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-0.5 text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-sm leading-relaxed text-slate-700">
        {children}
        <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse bg-brand-500" />
      </p>
    </div>
  );
}
