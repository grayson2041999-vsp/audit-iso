'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnalysisProgress } from './AnalysisProgress';

/**
 * Nút chuẩn hoá cho finding đã lưu nháp nhưng chưa qua AI.
 * Cho phép đánh giá viên ghi nhanh ngoài hiện trường rồi ngồi chuẩn hoá sau.
 */
export function StandardizeLater({
  auditId, findingId, hasImages,
}: {
  auditId: string;
  findingId: string;
  hasImages: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/dot/${auditId}/findings/${findingId}/chuan-hoa`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Chuẩn hoá thất bại.');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lỗi không xác định.');
    } finally {
      setBusy(false);
    }
  }

  if (busy) {
    return (
      <div className="card p-5">
        <AnalysisProgress hasImages={hasImages} />
      </div>
    );
  }

  return (
    <div className="card p-5">
      <h2 className="font-semibold">Chưa chuẩn hoá</h2>
      <p className="mb-4 mt-1 text-sm text-slate-500">
        Finding này mới lưu phần ghi nhận thô. Chạy AI để chuẩn hoá theo cấu trúc
        Yêu cầu – Sự không phù hợp – Bằng chứng khách quan của ISO.
      </p>

      {error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <button onClick={run} className="btn-primary">Chuẩn hoá bằng AI</button>

      <p className="mt-3 text-xs text-slate-400">
        Chưa chuẩn hoá thì chưa nộp được — trưởng đoàn cần bản đã chuẩn hoá để đưa vào báo cáo.
      </p>
    </div>
  );
}
