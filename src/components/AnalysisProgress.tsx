'use client';

import { useEffect, useState } from 'react';

/**
 * Hiển thị tiến trình trong lúc chờ AI chuẩn hoá.
 *
 * LƯU Ý VỀ TÍNH TRUNG THỰC: các bước dưới đây tích dần theo MỐC THỜI GIAN ƯỚC LƯỢNG,
 * không phải tiến độ thật của mô hình (API không trả về tiến độ từng phần).
 * Thứ tự các bước phản ánh đúng trình tự công việc, nhưng thời điểm chuyển bước là
 * ước lượng. Vì vậy giao diện KHÔNG hiển thị phần trăm, và có ghi chú rõ cho người dùng.
 */
export function AnalysisProgress({ hasImages }: { hasImages: boolean }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const stages = [
    { label: hasImages ? 'Đọc ghi nhận và hình ảnh hiện trường' : 'Đọc ghi nhận của auditor', at: 0 },
    { label: 'Đối chiếu danh mục điều khoản ISO', at: hasImages ? 6 : 4 },
    { label: 'Soạn phát biểu theo cấu trúc R–N–E', at: hasImages ? 15 : 11 },
    { label: 'Rà soát viện dẫn và bằng chứng khách quan', at: hasImages ? 27 : 21 },
  ];

  const current = stages.reduce((acc, s, i) => (elapsed >= s.at ? i : acc), 0);
  const slow = elapsed >= 60;

  return (
    <div className="space-y-5">
      {/* --- Danh sách bước --- */}
      <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <p className="text-sm font-medium text-slate-700">AI đang phân tích</p>
          <span className="font-mono text-xs tabular-nums text-slate-500">
            {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
          </span>
        </div>

        <ul className="space-y-2.5">
          {stages.map((s, i) => {
            const done = i < current;
            const active = i === current;
            return (
              <li key={i} className="flex items-center gap-2.5 text-sm">
                {done ? (
                  <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-emerald-500 text-[10px] font-bold text-white">
                    ✓
                  </span>
                ) : active ? (
                  <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
                ) : (
                  <span className="h-4 w-4 shrink-0 rounded-full border-2 border-slate-200" />
                )}
                <span
                  className={
                    done ? 'text-slate-500' : active ? 'font-medium text-slate-800' : 'text-slate-400'
                  }
                >
                  {s.label}
                </span>
              </li>
            );
          })}
        </ul>

        <p className="mt-3 border-t border-slate-200 pt-2.5 text-xs text-slate-400">
          Các bước hiển thị theo trình tự ước lượng, không phải tiến độ thực của mô hình.
        </p>
      </div>

      {slow && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Lâu hơn thường lệ. Ghi nhận dài hoặc nhiều ảnh sẽ mất thêm thời gian — cứ để yên, đừng bấm lại.
        </p>
      )}

      {/* --- Khung xương đúng hình dạng kết quả sắp hiện --- */}
      <div className="space-y-4" aria-hidden>
        <div className="flex items-center gap-2">
          <div className="h-6 w-32 animate-pulse rounded-md bg-slate-200" />
          <div className="h-6 w-40 animate-pulse rounded-md bg-slate-100" />
        </div>
        <div className="h-10 animate-pulse rounded-lg bg-slate-100" />
        <div className="space-y-2">
          <div className="h-4 w-24 animate-pulse rounded bg-slate-200" />
          <div className="h-14 animate-pulse rounded-lg bg-slate-100" />
          <div className="h-14 animate-pulse rounded-lg bg-slate-100" />
        </div>
        <div className="space-y-2">
          <div className="h-4 w-48 animate-pulse rounded bg-slate-200" />
          <div className="h-28 animate-pulse rounded-lg bg-slate-100" />
        </div>
      </div>
    </div>
  );
}
