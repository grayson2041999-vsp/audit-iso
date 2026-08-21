'use client';

import { useEffect, useRef, useState } from 'react';
import { parsePartialJson } from '@/lib/partial-json';
import { formatClauseRefs } from '@/lib/iso';
import type { Checklist, ChecklistGroup } from '@/lib/types';

/** Dàn ý máy chủ gửi trước khi model viết chữ đầu tiên. Xem route sinh checklist. */
export type ChecklistMeta = {
  groups: string[];
  target: { lo: number; hi: number };
  standards: string[];
  sessionMinutes: number | null;
};

type StreamEvent =
  | { type: 'meta'; groups: string[]; target: { lo: number; hi: number }; standards: string[]; sessionMinutes: number | null }
  | { type: 'delta'; text: string }
  | {
      type: 'done';
      result: Checklist;
      warnings?: string[];
      quota?: { remaining: number; limit: number };
    }
  | { type: 'error'; error: string };

/** Dòng model đang viết dở, chưa đủ để đưa vào bảng chính thức. */
type InFlight = { groupName: string; task: string } | null;

/**
 * Tách phần ĐÃ XONG khỏi phần ĐANG VIẾT trong chuỗi JSON chảy về.
 *
 * Đây là chỗ quyết định việc rút ngắn thời gian chờ. Model sinh các trường theo
 * đúng thứ tự khai báo, nên mọi dòng TRỪ dòng cuối cùng đều đã viết xong hẳn —
 * đưa thẳng vào bảng chính thức được, không phải đợi hết ba mươi dòng.
 *
 * Dòng cuối thì chưa: chữ có thể đang đứt giữa câu, và mảng `clauses` nằm sau
 * `task` trong schema nên chưa chắc đã về. Dòng đó hiện riêng, mờ và chưa cho sửa.
 */
function splitStream(p: Partial<Checklist> | null): { groups: ChecklistGroup[]; inFlight: InFlight } | null {
  /**
   * TRẢ `null` KHI CHƯA ĐỌC ĐƯỢC, KHÔNG TRẢ MẢNG RỖNG — khác biệt này quan trọng.
   *
   * `parsePartialJson` vá tạm chuỗi JSON còn dở, và ở một số điểm cắt nó vá
   * không nổi rồi trả `null`. Nếu chỗ này quy về "không có dòng nào", giao diện
   * sẽ hiểu nhầm là bảng vừa rỗng đi: cả bảng chớp tắt giữa chừng.
   *
   * Đã kiểm bằng cách phát lại luồng theo từng byte: hiện tượng này xảy ra
   * hàng chục lần trong một lần sinh, ở mọi kích thước mẩu.
   */
  if (!p || !Array.isArray(p.groups)) return null;

  const raw = p.groups.filter((g) => typeof g?.name === 'string' && g.name.length > 0);

  const flat: { gi: number; name: string; task: string; clauses: ChecklistGroup['items'][number]['clauses'] }[] = [];
  raw.forEach((g, gi) => {
    (g.items ?? []).forEach((it) => {
      if (typeof it?.task !== 'string' || it.task.length === 0) return;
      flat.push({ gi, name: g.name, task: it.task, clauses: it.clauses ?? [] });
    });
  });

  if (flat.length === 0) return null;

  const last = flat[flat.length - 1];
  const settled = flat.slice(0, -1);

  const groups: ChecklistGroup[] = [];
  for (const row of settled) {
    const tail = groups[groups.length - 1];
    if (tail && tail.name === row.name) tail.items.push({ task: row.task, clauses: row.clauses });
    else groups.push({ name: row.name, items: [{ task: row.task, clauses: row.clauses }] });
  }

  return { groups, inFlight: { groupName: last.name, task: last.task } };
}

/**
 * Ghép bản mới từ luồng vào bản đang hiển thị, GIỮ NGUYÊN những dòng người dùng
 * đã sửa tay.
 *
 * Cần thiết vì bảng giờ sửa được ngay trong lúc model vẫn đang viết: không có
 * lớp này thì mỗi mẩu JSON về là một lần đè lên chữ người ta vừa gõ.
 *
 * Chỉ bảo vệ `task` — phần chữ. `clauses` luôn lấy bản mới nhất từ luồng, vì
 * người dùng không sửa được viện dẫn và chúng về SAU phần chữ.
 */
function mergeGroups(
  prev: ChecklistGroup[] | null,
  next: ChecklistGroup[],
  edited: Set<string>,
): ChecklistGroup[] {
  return next.map((g, gi) => ({
    name: g.name,
    items: g.items.map((it, ii) => {
      const mine = edited.has(`${gi}:${ii}`) ? prev?.[gi]?.items?.[ii]?.task : undefined;
      return { task: mine ?? it.task, clauses: it.clauses ?? [] };
    }),
  }));
}

/**
 * Màn hình soạn checklist đánh giá cho một đơn vị.
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
  /** Model đã viết xong hẳn. Trước mốc này chỉ cho sửa chữ, chưa cho thêm/xoá dòng. */
  const [finished, setFinished] = useState(false);
  const [partial, setPartial] = useState<Partial<Checklist> | null>(null);
  const [groups, setGroups] = useState<ChecklistGroup[] | null>(null);
  const [inFlight, setInFlight] = useState<InFlight>(null);
  const [summary, setSummary] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [meta, setMeta] = useState<ChecklistMeta | null>(null);

  const startRef = useRef<HTMLDivElement>(null);
  /** Cho phép bỏ ngang giữa chừng — chờ một phút mà không huỷ được thì rất bí. */
  const abortRef = useRef<AbortController | null>(null);
  /** Khoá "gi:ii" của những dòng người dùng đã sửa tay, để luồng không đè lên. */
  const editedRef = useRef<Set<string>>(new Set());
  /** Số dòng nhiều nhất đã từng lên bảng — chặn bảng ngắn lại giữa chừng. */
  const settledRef = useRef(0);

  const total = groups?.reduce((n, g) => n + g.items.length, 0) ?? 0;
  const hasRows = total > 0 || Boolean(inFlight);

  /**
   * Chặn đóng tab khi có checklist chưa tải về.
   *
   * Không lưu vào cơ sở dữ liệu nghĩa là đóng nhầm tab là mất trắng, và phải
   * sinh lại — tốn thêm ba lượt AI. Cảnh báo này là thứ duy nhất đứng giữa.
   */
  useEffect(() => {
    if (!hasRows || downloaded) return;
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [hasRows, downloaded]);

  async function handleGenerate() {
    setError(null);
    setWarnings([]);
    if (description.trim().length < 30) {
      return setError('Cần ít nhất 30 ký tự mô tả chức năng, nhiệm vụ của đơn vị.');
    }

    setLoading(true);
    setFinished(false);
    setPartial(null);
    setGroups(null);
    setInFlight(null);
    setSummary('');
    setMeta(null);
    setDownloaded(false);
    editedRef.current = new Set();
    settledRef.current = 0;

    const controller = new AbortController();
    abortRef.current = controller;
    setTimeout(() => startRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);

    try {
      const res = await fetch(`/api/dot/${auditId}/don-vi/${unitId}/checklist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description }),
        signal: controller.signal,
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
        const { value, done: closed } = await reader.read();
        if (closed) break;

        rest += decoder.decode(value, { stream: true });
        const lines = rest.split('\n');
        rest = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as StreamEvent;

          if (ev.type === 'error') throw new Error(ev.error);

          if (ev.type === 'meta') {
            setMeta({
              groups: ev.groups,
              target: ev.target,
              standards: ev.standards,
              sessionMinutes: ev.sessionMinutes,
            });
            continue;
          }

          if (ev.type === 'delta') {
            json += ev.text;
            const p = parsePartialJson<Checklist>(json);
            setPartial(p);
            if (p?.unitSummary) setSummary(p.unitSummary);

            // Đẩy thẳng những dòng đã xong vào bảng chính thức, không đợi hết.
            const split = splitStream(p);
            if (split) {
              setInFlight(split.inFlight);
              /**
               * CHỈ ĐI LÊN, KHÔNG ĐI XUỐNG. Một mẩu JSON đọc hụt có thể cho ra
               * ít dòng hơn lần trước; áp thẳng vào là bảng ngắn lại trước mắt
               * người đang đọc dở, và tệ hơn là `mergeGroups` ghép lệch chỉ số
               * nên chữ họ vừa sửa nhảy sang dòng khác.
               */
              if (split.groups.length > 0) {
                const n = split.groups.reduce((k, g) => k + g.items.length, 0);
                if (n >= settledRef.current) {
                  settledRef.current = n;
                  setGroups((prev) => mergeGroups(prev, split.groups, editedRef.current));
                }
              }
            }
            continue;
          }

          done = true;
          setSummary(ev.result.unitSummary);
          setInFlight(null);
          setGroups((prev) => mergeGroups(prev, ev.result.groups, editedRef.current));
          setFinished(true);

          const quotaWarning =
            ev.quota && ev.quota.remaining <= 5
              ? [`Còn ${Math.max(0, ev.quota.remaining)}/${ev.quota.limit} lượt AI trong giờ này.`]
              : [];
          setWarnings([...(ev.warnings ?? []), ...quotaWarning]);
        }
      }

      if (!done) throw new Error('Kết nối tới AI bị ngắt giữa chừng. Vui lòng thử lại.');
    } catch (e) {
      // Người dùng tự bấm huỷ thì không phải lỗi, không báo đỏ.
      if (e instanceof DOMException && e.name === 'AbortError') {
        setInFlight(null);
        if (total > 0) setFinished(true);
        return;
      }
      setError(e instanceof Error ? e.message : 'Lỗi không xác định.');
    } finally {
      abortRef.current = null;
      setLoading(false);
      setPartial(null);
    }
  }

  function handleCancel() {
    abortRef.current?.abort();
  }

  async function handleDownload() {
    if (!groups) return;
    setDownloading(true);
    setError(null);
    try {
      const res = await fetch(`/api/dot/${auditId}/don-vi/${unitId}/checklist/xuat-word`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groups: groups
            .map((g) => ({ ...g, items: g.items.filter((it) => it.task.trim().length > 0) }))
            .filter((g) => g.items.length > 0),
        }),
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
    editedRef.current.add(`${gi}:${ii}`);
    setGroups((prev) =>
      (prev ?? []).map((g, x) =>
        x !== gi ? g : { ...g, items: g.items.map((it, y) => (y !== ii ? it : { ...it, task })) },
      ),
    );
    setDownloaded(false);
  }

  function removeItem(gi: number, ii: number) {
    setGroups((prev) =>
      (prev ?? []).map((g, x) => (x !== gi ? g : { ...g, items: g.items.filter((_, y) => y !== ii) })),
    );
    setDownloaded(false);
  }

  function addItem(gi: number) {
    setGroups((prev) =>
      (prev ?? []).map((g, x) => (x !== gi ? g : { ...g, items: [...g.items, { task: '', clauses: [] }] })),
    );
    setDownloaded(false);
  }

  /* ------------------------------ giao diện ------------------------------ */

  /** Số thứ tự liên tục qua các nhóm, giống hệt cách đánh số trong file Word. */
  const numberAt = (gi: number, ii: number) =>
    (groups ?? []).slice(0, gi).reduce((n, x) => n + x.items.length, 0) + ii + 1;

  return (
    <div className="space-y-6">
      {/* Bước 1 — mô tả đơn vị. Mờ đi trong lúc chờ để mắt dồn xuống phần kết quả. */}
      <div
        className={`card space-y-4 p-5 transition-opacity ${loading ? 'pointer-events-none opacity-50' : ''}`}
      >
        <div>
          <h2 className="font-medium">Chức năng, nhiệm vụ của {unitName}</h2>
          <p className="mt-1 text-sm text-slate-500">
            Hãy mô tả {unitName}: chức năng nhiệm vụ, các quá trình chính, nhân sự, cơ sở
            vật chất và thiết bị. Thông tin càng cụ thể thì danh mục đề xuất càng sát với
            thực tế.
          </p>
        </div>

        <textarea
          className="input min-h-[220px] font-normal leading-relaxed"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={loading}
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-slate-400">{description.trim().length} ký tự</span>
          <button className="btn-primary" onClick={handleGenerate} disabled={loading}>
            {loading ? 'Đang soạn…' : hasRows ? 'Soạn lại' : 'Soạn danh mục công việc'}
          </button>
        </div>
      </div>

      {error && <p className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>}

      <div ref={startRef} className="space-y-4">
        {/*
          Màn hình chờ đầy đủ CHỈ tồn tại tới khi có dòng đầu tiên — thường là
          bảy tám giây. Từ đó trở đi nó co lại thành một thanh mảnh, nhường chỗ
          cho bảng kết quả thật, vì người dùng đã có cái để đọc và sửa.
        */}
        {loading && !hasRows && <Progress partial={partial} meta={meta} onCancel={handleCancel} />}
        {loading && hasRows && (
          <CompactProgress done={total} meta={meta} onCancel={handleCancel} />
        )}

        {summary && (
          <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
              AI hiểu đơn vị này như sau
            </p>
            <p className="text-sm leading-relaxed text-slate-700">{summary}</p>
            {finished && (
              <p className="mt-2 text-xs text-slate-500">
                Hiểu sai chỗ nào thì bổ sung vào phần mô tả ở trên rồi bấm “Soạn lại”.
              </p>
            )}
          </div>
        )}

        {warnings.length > 0 && (
          <ul className="space-y-1 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {warnings.map((w, i) => (
              <li key={i}>• {w}</li>
            ))}
          </ul>
        )}

        {hasRows && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-600">
              <strong>{total}</strong> dòng công việc.{' '}
              {finished
                ? 'Sửa chữ, xoá dòng hoặc thêm dòng tự viết trước khi tải — máy chủ không giữ bản nào, tải về là bản cuối.'
                : 'Sửa được ngay từ bây giờ, không phải đợi AI viết xong.'}
            </p>
            <button
              className="btn-primary"
              onClick={handleDownload}
              disabled={downloading || total === 0 || loading}
              title={loading ? 'Đợi AI viết xong rồi mới tải được' : undefined}
            >
              {downloading ? 'Đang tạo file…' : 'Tải file Word'}
            </button>
          </div>
        )}

        {downloaded && (
          <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            Đã tải file Word. Sửa tiếp thì tải lại — bản mới sẽ ghi đè bản cũ trong thư mục
            tải xuống.
          </p>
        )}

        {(groups ?? []).map((g, gi) => (
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
                    {numberAt(gi, ii)}
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
                  {/*
                    Thêm/xoá dòng chỉ mở sau khi AI viết xong. Trong lúc còn chảy,
                    hai nút này làm lệch chỉ số dòng mà lớp ghép ở `mergeGroups`
                    dùng để nhận ra dòng nào người dùng đã sửa — lệch một cái là
                    chữ vừa gõ bị đè.
                  */}
                  {finished && (
                    <button
                      className="mt-1 h-7 shrink-0 rounded px-2 text-xs text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                      onClick={() => removeItem(gi, ii)}
                      title="Xoá dòng"
                    >
                      Xoá
                    </button>
                  )}
                </li>
              ))}

              {/* Dòng model đang viết dở — hiện mờ, chưa cho sửa */}
              {inFlight && inFlight.groupName === g.name && gi === (groups?.length ?? 0) - 1 && (
                <li className="flex gap-3 p-3">
                  <span className="mt-1.5 w-5 shrink-0 text-right text-xs tabular-nums text-slate-300">
                    {total + 1}
                  </span>
                  <p className="min-w-0 flex-1 pt-1 text-sm leading-relaxed text-slate-400">
                    {inFlight.task}
                    <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse bg-brand-500" />
                  </p>
                </li>
              )}
            </ul>

            {finished && (
              <div className="border-t border-slate-100 px-3 py-2">
                <button
                  className="text-xs font-medium text-brand-600 hover:underline"
                  onClick={() => addItem(gi)}
                >
                  + Thêm dòng tự viết
                </button>
              </div>
            )}
          </div>
        ))}

        {/* Nhóm mới vừa mở, dòng đầu tiên của nó còn đang viết */}
        {inFlight && !(groups ?? []).some((g) => g.name === inFlight.groupName) && (
          <div className="card overflow-hidden opacity-70">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
                {inFlight.groupName}
              </h3>
            </div>
            <div className="flex gap-3 p-3">
              <span className="mt-1.5 w-5 shrink-0 text-right text-xs tabular-nums text-slate-300">
                {total + 1}
              </span>
              <p className="min-w-0 flex-1 pt-1 text-sm leading-relaxed text-slate-400">
                {inFlight.task}
                <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse bg-brand-500" />
              </p>
            </div>
          </div>
        )}

        {finished && total > 0 && (
          <p className="text-xs text-slate-400">
            File Word có sẵn ba dòng trắng ở cuối để ghi việc phát sinh tại chỗ, không cần
            thêm ở đây.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Thanh gọn, thay cho màn hình chờ đầy đủ khi đã có dòng đầu tiên.
 *
 * Từ mốc này người dùng có việc để làm — đọc và sửa những dòng đã về — nên phần
 * còn lại của quá trình chỉ cần một dải mỏng báo còn bao xa, không được chiếm
 * chỗ của bảng kết quả nữa.
 */
function CompactProgress({
  done,
  meta,
  onCancel,
}: {
  done: number;
  meta: ChecklistMeta | null;
  onCancel: () => void;
}) {
  const target = meta?.target.hi ?? 30;
  const pct = Math.min(95, Math.round((done / target) * 100));
  const remaining = meta ? meta.groups.length : 0;

  return (
    <div className="sticky top-2 z-10 overflow-hidden rounded-lg border border-slate-200 bg-white/95 shadow-sm backdrop-blur">
      <div className="h-1 w-full bg-slate-100">
        <div
          className="h-full bg-brand-500 transition-[width] duration-700 ease-out"
          style={{ width: `${Math.max(4, pct)}%` }}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
        <p className="flex items-center gap-2 text-sm text-slate-600">
          <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
          AI đang viết tiếp — bạn đọc và sửa được ngay
        </p>
        <div className="flex items-center gap-3">
          <span className="text-xs tabular-nums text-slate-500">
            {done}/{meta ? `${meta.target.lo}–${meta.target.hi}` : target} dòng
            {remaining > 0 && <span className="text-slate-400"> · {remaining} nhóm</span>}
          </span>
          <button className="btn-ghost !py-1 !text-xs" onClick={onCancel}>
            Dừng
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Màn hình chờ đầy đủ — chỉ sống trong quãng chưa có dòng nào, thường 5–8 giây.
 *
 * Chờ AI soạn xong mất khoảng nửa phút tới một phút. Cách chữa KHÔNG phải là
 * thanh chạy giả hay mấy câu "bạn có biết…" nhảy vòng; đánh giá viên đọc ra
 * ngay đó là đồ trang trí và mất tin vào phần còn lại của app.
 *
 * Ở đây mọi thứ hiện lên đều là việc thật:
 *
 *  · DÀN Ý đầy đủ có ngay từ giây 0, do máy chủ gửi kèm sự kiện `meta` trước
 *    khi model viết chữ đầu tiên.
 *  · TIẾN ĐỘ tính bằng số dòng đã viết trên số dòng dự kiến — tỉ lệ có thật,
 *    không phải hàm thời gian.
 *
 * Chốt trên 95% cho tới khi thật sự xong: model hay viết lệch trần một hai
 * dòng, và một thanh đứng ở 100% trong lúc vẫn quay là thứ khiến người dùng
 * nghĩ nó hỏng.
 */
function Progress({
  partial,
  meta,
  onCancel,
}: {
  partial: Partial<Checklist> | null;
  meta: ChecklistMeta | null;
  onCancel: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const readingUnit = !partial?.unitSummary;
  const outline = meta?.groups ?? [];

  return (
    <div className="card overflow-hidden">
      <div className="h-1 w-full bg-slate-100">
        <div className="h-full w-[4%] bg-brand-500" />
      </div>

      <div className="space-y-5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2.5 text-sm font-medium text-slate-800">
            <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
            {readingUnit ? 'AI đang đọc mô tả đơn vị' : 'AI đang soạn danh mục công việc'}
          </p>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            {meta && (
              <span className="tabular-nums">
                0/{meta.target.lo}–{meta.target.hi} dòng
              </span>
            )}
            <span className="font-mono tabular-nums">
              {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
            </span>
          </div>
        </div>

        <ol className="space-y-2">
          <Step done={!readingUnit} active={readingUnit} label="Đọc chức năng, nhiệm vụ của đơn vị" />
          <Step
            done={false}
            active={!readingUnit}
            label={
              meta
                ? `Đối chiếu điều khoản áp dụng — ${meta.standards.join(' · ')}`
                : 'Đối chiếu điều khoản áp dụng'
            }
          />
          <Step done={false} active={false} label="Soạn công việc theo từng nhóm" />
        </ol>

        {outline.length > 0 && (
          <ul className="space-y-1.5 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
            {outline.map((name) => (
              <li key={name} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-slate-400">{name}</span>
                <span className="shrink-0 text-xs tabular-nums text-slate-400">—</span>
              </li>
            ))}
          </ul>
        )}

        {partial?.unitSummary ? (
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
              AI hiểu đơn vị này như sau
            </p>
            <p className="text-sm leading-relaxed text-slate-700">
              {partial.unitSummary}
              <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse bg-brand-500" />
            </p>
          </div>
        ) : (
          <div className="space-y-2.5" aria-hidden>
            <div className="h-3.5 w-2/3 animate-pulse rounded bg-slate-200" />
            <div className="h-3.5 w-5/6 animate-pulse rounded bg-slate-100" />
            <div className="h-3.5 w-1/3 animate-pulse rounded bg-slate-100" />
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <p className="text-xs text-slate-400">
            {elapsed >= 30
              ? 'Lâu hơn thường lệ — mô tả dài thì mất thêm thời gian. Cứ để yên, đừng bấm lại.'
              : 'Dòng đầu tiên thường hiện ra sau khoảng 5–10 giây.'}
          </p>
          <button className="btn-ghost !py-1.5 !text-xs" onClick={onCancel}>
            Huỷ
          </button>
        </div>
      </div>
    </div>
  );
}

/** Một bước trong ba bước lớn: đã xong · đang làm · chưa tới. */
function Step({ done, active, label }: { done: boolean; active: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2.5 text-sm">
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
          done
            ? 'bg-emerald-100 text-emerald-700'
            : active
              ? 'bg-brand-100 text-brand-700'
              : 'bg-slate-100 text-slate-300'
        }`}
      >
        {done ? '✓' : active ? '•' : ''}
      </span>
      <span className={done ? 'text-slate-500' : active ? 'font-medium text-slate-800' : 'text-slate-400'}>
        {label}
      </span>
    </li>
  );
}
