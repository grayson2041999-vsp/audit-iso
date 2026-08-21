'use client';

import { useEffect, useRef, useState } from 'react';
import { parsePartialJson } from '@/lib/partial-json';
import { formatClauseRefs } from '@/lib/iso';
import type { Checklist, ChecklistGroup } from '@/lib/types';

const PLACEHOLDER = `Ví dụ:

Phòng Kỹ thuật, 12 người. Chức năng: quản lý và bảo dưỡng toàn bộ thiết bị sản xuất
của xí nghiệp; lập kế hoạch bảo dưỡng định kỳ; sửa chữa đột xuất; quản lý kho vật tư
phụ tùng; theo dõi hiệu chuẩn thiết bị đo.

Đơn vị có xưởng cơ khí riêng (máy tiện, máy hàn), có sử dụng dầu mỡ và dung môi tẩy
rửa, phát sinh giẻ lau nhiễm dầu. Thuê nhà thầu ngoài khi sửa chữa hệ thống điện
cao thế. Đang dùng phần mềm quản lý bảo dưỡng và sổ tay ghi chép giấy song song.`;

type StreamEvent =
  | { type: 'delta'; text: string }
  | {
      type: 'done';
      result: Checklist;
      warnings?: string[];
      quota?: { remaining: number; limit: number };
    }
  | { type: 'error'; error: string };

/**
 * Màn hình soạn checklist đánh giá cho một đơn vị.
 *
 * Ba trạng thái nối tiếp nhau trong CÙNG một trang, không điều hướng đi đâu:
 * nhập mô tả → xem AI viết dần → rà soát và tải file Word.
 *
 * Không có bước lưu. Checklist không tồn tại ở đâu ngoài state của trang này
 * cho tới khi bấm tải — xem `docs/concept-checklist.md` mục 8. Đó là lý do có
 * cảnh báo `beforeunload` bên dưới.
 */
export function ChecklistBuilder({
  auditId,
  unitId,
  unitName,
}: {
  auditId: string;
  unitId: string;
  unitName: string;
}) {
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [partial, setPartial] = useState<Partial<Checklist> | null>(null);
  const [groups, setGroups] = useState<ChecklistGroup[] | null>(null);
  const [summary, setSummary] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState(false);

  const resultRef = useRef<HTMLDivElement>(null);

  /**
   * Chặn đóng tab khi có checklist chưa tải về.
   *
   * Không lưu vào cơ sở dữ liệu nghĩa là đóng nhầm tab là mất trắng, và phải
   * sinh lại — tốn thêm ba lượt AI. Cảnh báo này là thứ duy nhất đứng giữa.
   */
  useEffect(() => {
    if (!groups || downloaded) return;
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [groups, downloaded]);

  const total = groups?.reduce((n, g) => n + g.items.length, 0) ?? 0;

  async function handleGenerate() {
    setError(null);
    setWarnings([]);
    if (description.trim().length < 30) {
      return setError('Cần ít nhất 30 ký tự mô tả chức năng, nhiệm vụ của đơn vị.');
    }

    setLoading(true);
    setPartial(null);
    setGroups(null);
    setDownloaded(false);

    try {
      const res = await fetch(`/api/dot/${auditId}/don-vi/${unitId}/checklist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Không sinh được checklist.');
      }

      // NDJSON: mỗi dòng một sự kiện; mẩu cuối mỗi lần đọc có thể cụt giữa dòng.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let rest = '';
      let json = '';
      let done = false;

      while (true) {
        const { value, done: finished } = await reader.read();
        if (finished) break;

        rest += decoder.decode(value, { stream: true });
        const lines = rest.split('\n');
        rest = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as StreamEvent;

          if (ev.type === 'error') throw new Error(ev.error);

          if (ev.type === 'delta') {
            json += ev.text;
            setPartial(parsePartialJson<Checklist>(json));
            continue;
          }

          done = true;
          setSummary(ev.result.unitSummary);
          setGroups(ev.result.groups);

          const quotaWarning =
            ev.quota && ev.quota.remaining <= 5
              ? [`Còn ${Math.max(0, ev.quota.remaining)}/${ev.quota.limit} lượt AI trong giờ này.`]
              : [];
          setWarnings([...(ev.warnings ?? []), ...quotaWarning]);
        }
      }

      if (!done) throw new Error('Kết nối tới AI bị ngắt giữa chừng. Vui lòng thử lại.');
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lỗi không xác định.');
    } finally {
      setLoading(false);
      setPartial(null);
    }
  }

  async function handleDownload() {
    if (!groups) return;
    setDownloading(true);
    setError(null);
    try {
      const res = await fetch(`/api/dot/${auditId}/don-vi/${unitId}/checklist/xuat-word`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groups: groups.filter((g) => g.items.length > 0) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Không tạo được file Word.');
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download =
        res.headers.get('Content-Disposition')?.match(/filename="(.+?)"/)?.[1] ??
        'checklist-danh-gia.docx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setDownloaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lỗi không xác định.');
    } finally {
      setDownloading(false);
    }
  }

  /* --------------------------- sửa các dòng --------------------------- */

  function editTask(gi: number, ii: number, task: string) {
    setGroups((prev) =>
      prev!.map((g, x) =>
        x !== gi ? g : { ...g, items: g.items.map((it, y) => (y !== ii ? it : { ...it, task })) },
      ),
    );
    setDownloaded(false);
  }

  function removeItem(gi: number, ii: number) {
    setGroups((prev) =>
      prev!.map((g, x) => (x !== gi ? g : { ...g, items: g.items.filter((_, y) => y !== ii) })),
    );
    setDownloaded(false);
  }

  function addItem(gi: number) {
    setGroups((prev) =>
      prev!.map((g, x) => (x !== gi ? g : { ...g, items: [...g.items, { task: '', clauses: [] }] })),
    );
    setDownloaded(false);
  }

  /* ------------------------------ giao diện ------------------------------ */

  return (
    <div className="space-y-6">
      {/* Bước 1 — mô tả đơn vị */}
      <div className="card space-y-4 p-5">
        <div>
          <h2 className="font-medium">Chức năng, nhiệm vụ của {unitName}</h2>
          <p className="mt-1 text-sm text-slate-500">
            Gõ tóm tắt hoặc dán quy chế hoạt động đơn vị cung cấp. Mô tả càng cụ thể —
            các quá trình chính, thiết bị, hoá chất, kho, nhà thầu, hồ sơ đang dùng — thì
            danh mục càng bám sát đơn vị này thay vì chung chung.
          </p>
        </div>

        <textarea
          className="input min-h-[220px] font-normal leading-relaxed"
          placeholder={PLACEHOLDER}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={loading}
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-slate-400">{description.trim().length} ký tự</span>
          <button className="btn-primary" onClick={handleGenerate} disabled={loading}>
            {loading ? 'Đang soạn…' : groups ? 'Soạn lại' : 'Soạn danh mục công việc'}
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>
      )}

      {/* Bước 2 — AI đang viết */}
      {loading && <Progress partial={partial} />}

      {/* Bước 3 — rà soát và tải */}
      {groups && !loading && (
        <div ref={resultRef} className="space-y-4">
          {summary && (
            <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
                AI hiểu đơn vị này như sau
              </p>
              <p className="text-sm leading-relaxed text-slate-700">{summary}</p>
              <p className="mt-2 text-xs text-slate-500">
                Hiểu sai chỗ nào thì bổ sung vào phần mô tả ở trên rồi bấm “Soạn lại”.
              </p>
            </div>
          )}

          {warnings.length > 0 && (
            <ul className="space-y-1 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {warnings.map((w, i) => (
                <li key={i}>• {w}</li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-600">
              <strong>{total}</strong> dòng công việc. Sửa chữ, xoá dòng hoặc thêm dòng tự viết
              trước khi tải — máy chủ không giữ bản nào, tải về là bản cuối.
            </p>
            <button className="btn-primary" onClick={handleDownload} disabled={downloading || total === 0}>
              {downloading ? 'Đang tạo file…' : 'Tải file Word'}
            </button>
          </div>

          {downloaded && (
            <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              Đã tải file Word. Sửa tiếp thì tải lại — bản mới sẽ ghi đè bản cũ trong thư mục
              tải xuống.
            </p>
          )}

          {groups.map((g, gi) => (
            <div key={gi} className="card overflow-hidden">
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
                  {g.name}
                </h3>
              </div>
              <ul className="divide-y divide-slate-100">
                {g.items.map((it, ii) => (
                  <li key={ii} className="flex gap-3 p-3">
                    <span className="mt-2 w-5 shrink-0 text-right text-xs tabular-nums text-slate-400">
                      {groups.slice(0, gi).reduce((n, x) => n + x.items.length, 0) + ii + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <textarea
                        className="input min-h-[64px] text-sm"
                        value={it.task}
                        placeholder="Việc cần làm…"
                        onChange={(e) => editTask(gi, ii, e.target.value)}
                      />
                      {it.clauses && it.clauses.length > 0 && (
                        <p className="mt-1 text-xs italic text-slate-500">
                          {formatClauseRefs(it.clauses)}
                        </p>
                      )}
                    </div>
                    <button
                      className="mt-1 h-7 shrink-0 rounded px-2 text-xs text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                      onClick={() => removeItem(gi, ii)}
                      title="Xoá dòng"
                    >
                      Xoá
                    </button>
                  </li>
                ))}
              </ul>
              <div className="border-t border-slate-100 px-3 py-2">
                <button
                  className="text-xs font-medium text-brand-600 hover:underline"
                  onClick={() => addItem(gi)}
                >
                  + Thêm dòng tự viết
                </button>
              </div>
            </div>
          ))}

          <p className="text-xs text-slate-400">
            File Word có sẵn ba dòng trắng ở cuối để ghi việc phát sinh tại chỗ, không cần
            thêm ở đây.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Màn hình chờ. Cùng cách làm với `AnalysisProgress`: không đoán tiến độ, chỉ
 * hiện đúng những gì model đã viết xong.
 *
 * `unitSummary` ra trước tiên nên đánh giá viên biết ngay AI có hiểu đúng đơn
 * vị không — sai thì bấm huỷ luôn thay vì đợi hết ba mươi dòng.
 */
function Progress({ partial }: { partial: Partial<Checklist> | null }) {
  const groups = partial?.groups?.filter((g) => g?.name) ?? [];
  const count = groups.reduce((n, g) => n + (g.items?.length ?? 0), 0);

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
      <p className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-700">
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
        {partial?.unitSummary ? 'AI đang soạn danh mục' : 'AI đang đọc mô tả đơn vị'}
        {count > 0 && <span className="text-slate-400">· {count} dòng</span>}
      </p>

      {partial?.unitSummary ? (
        <div className="space-y-3">
          <p className="text-sm leading-relaxed text-slate-700">{partial.unitSummary}</p>
          {groups.length > 0 && (
            <ul className="space-y-1">
              {groups.map((g, i) => (
                <li key={i} className="text-sm text-slate-600">
                  <span className="font-medium">{g.name}</span>
                  <span className="text-slate-400"> · {g.items?.length ?? 0} dòng</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="space-y-3" aria-hidden>
          <div className="h-4 w-2/3 animate-pulse rounded bg-slate-200" />
          <div className="h-4 w-1/3 animate-pulse rounded bg-slate-100" />
          <div className="h-16 animate-pulse rounded-lg bg-slate-100" />
        </div>
      )}
    </div>
  );
}
