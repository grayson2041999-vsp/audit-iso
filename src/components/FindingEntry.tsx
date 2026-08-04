'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ImageUploader, type UploadedImage } from './ImageUploader';
import { AnalysisProgress } from './AnalysisProgress';
import { SeverityBadge } from './Badge';
import { STANDARD_LABELS, SEVERITY_LABELS, type StandardCode } from '@/lib/iso';
import { suggestDueDate, DUE_DAYS_BY_SEVERITY, type StandardizedFinding } from '@/lib/types';

const STANDARDS = Object.keys(STANDARD_LABELS) as StandardCode[];

type Props = {
  auditId: string;
  unitId: string;
  unitName: string;
  memberName: string;
  /** Tiêu chuẩn đã khai báo cho đợt — điền sẵn, đánh giá viên chỉnh được. */
  defaultStandards: StandardCode[];
};

export function FindingEntry({
  auditId, unitId, unitName, memberName, defaultStandards,
}: Props) {
  const router = useRouter();

  const [rawText, setRawText] = useState('');
  const [standards, setStandards] = useState<StandardCode[]>(
    defaultStandards.length ? defaultStandards : ['ISO9001'],
  );
  const [area, setArea] = useState('');
  const [images, setImages] = useState<UploadedImage[]>([]);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [restored, setRestored] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [result, setResult] = useState<StandardizedFinding | null>(null);

  // Thời hạn khắc phục: gợi ý theo mức độ, nhưng một khi auditor tự sửa thì
  // không tự tính lại nữa (dueDateTouched) để không ghi đè quyết định của họ.
  const [dueDate, setDueDate] = useState('');
  const [dueDateTouched, setDueDateTouched] = useState(false);

  /**
   * Tự lưu tạm nội dung đang gõ vào bộ nhớ trình duyệt.
   * Auditor làm việc ngoài hiện trường, mạng chập chờn, hay bị chuyển app —
   * mất 200 chữ vừa gõ là mất luôn niềm tin vào công cụ.
   * Chỉ lưu phần chữ, không lưu ảnh (ảnh đã nằm trên R2 rồi).
   */
  const storageKey = `nhap:${auditId}:${unitId}`;
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as {
        rawText?: string; area?: string; standards?: StandardCode[];
      };
      if (saved.rawText?.trim()) {
        setRawText(saved.rawText);
        setArea(saved.area ?? '');
        if (saved.standards?.length) setStandards(saved.standards);
        setRestored(true);
      }
    } catch {
      /* bộ nhớ trình duyệt bị chặn — bỏ qua, không ảnh hưởng chức năng chính */
    }
  }, [storageKey]);

  useEffect(() => {
    if (!loadedRef.current) return;
    const t = setTimeout(() => {
      try {
        if (rawText.trim() || area.trim()) {
          window.localStorage.setItem(
            storageKey,
            JSON.stringify({ rawText, area, standards }),
          );
        } else {
          window.localStorage.removeItem(storageKey);
        }
      } catch {
        /* bỏ qua */
      }
    }, 800);
    return () => clearTimeout(t);
  }, [rawText, area, standards, storageKey]);

  function clearDraftCache() {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      /* bỏ qua */
    }
  }

  function toggleStandard(s: StandardCode) {
    setStandards((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  async function handleStandardize() {
    setError(null);
    setWarnings([]);
    if (rawText.trim().length < 10) return setError('Nội dung ghi nhận cần tối thiểu 10 ký tự.');
    if (standards.length === 0) return setError('Chọn ít nhất một tiêu chuẩn.');

    setLoading(true);
    try {
      const res = await fetch('/api/standardize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawText, standards, area,
          auditee: unitName,
          auditorName: memberName,
          imageKeys: images.map((i) => i.key),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Chuẩn hoá thất bại.');
      setResult(data.result);
      setWarnings(data.warnings ?? []);
      if (!dueDateTouched) setDueDate(suggestDueDate(data.result.severity));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lỗi không xác định.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!result) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/dot/${auditId}/findings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unitId,
          rawText, standards, area,
          dueDate: dueDate || null,
          ai: result,
          images: images.map((i) => ({
            key: i.key, fileName: i.fileName, contentType: i.contentType, size: i.size,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Lưu thất bại.');
      clearDraftCache();
      router.push(`/dot/${auditId}/finding/${data.finding.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lỗi khi lưu.');
      setSaving(false);
    }
  }

  /** Lưu ghi nhận thô, chưa qua AI. Chuẩn hoá sau ở trang chi tiết. */
  async function handleSaveDraft() {
    setError(null);
    if (rawText.trim().length < 10) return setError('Nội dung ghi nhận cần tối thiểu 10 ký tự.');

    setSavingDraft(true);
    try {
      const res = await fetch(`/api/dot/${auditId}/findings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unitId,
          rawText, standards, area,
          images: images.map((i) => ({
            key: i.key, fileName: i.fileName, contentType: i.contentType, size: i.size,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Lưu nháp thất bại.');
      clearDraftCache();
      router.push(`/dot/${auditId}/finding/${data.finding.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lỗi khi lưu nháp.');
      setSavingDraft(false);
    }
  }

  function patch<K extends keyof StandardizedFinding>(k: K, v: StandardizedFinding[K]) {
    setResult((r) => (r ? { ...r, [k]: v } : r));
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* ---------------- Cột trái: nhập liệu ---------------- */}
      <section className="card p-5">
        <h2 className="mb-1 text-lg font-semibold">1. Ghi nhận tại hiện trường</h2>
        {restored && (
          <p className="mb-4 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-900">
            <span className="flex-1">Đã khôi phục nội dung bạn gõ dở lần trước.</span>
            <button
              onClick={() => {
                setRawText('');
                setArea('');
                setRestored(false);
                clearDraftCache();
              }}
              className="shrink-0 text-xs underline"
            >
              Bỏ đi, nhập mới
            </button>
          </p>
        )}

        <p className="mb-5 rounded-lg bg-slate-50 px-3 py-2.5 text-sm">
          Đơn vị được đánh giá: <strong>{unitName}</strong>
        </p>

        <div className="mb-4">
          <label className="label">Tiêu chuẩn áp dụng *</label>
          <div className="space-y-2">
            {STANDARDS.map((s) => (
              <label
                key={s}
                className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 p-2.5 text-sm hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={standards.includes(s)}
                  onChange={() => toggleStandard(s)}
                  className="mt-0.5 h-4 w-4 accent-brand-600"
                />
                <span>{STANDARD_LABELS[s]}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="mb-4">
          <label className="label">Nội dung ghi nhận *</label>
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            rows={9}
            className="input font-normal"
            placeholder="Mô tả điều bạn quan sát được tại hiện trường…"
          />
          {/*
            Cố ý viết trung tính, KHÔNG dùng những từ như "bất thường" hay "sai
            quy định": hướng dẫn nghiêng về vi phạm sẽ đẩy đánh giá viên vào tâm
            thế săn lỗi, và những gì đáng ghi nhận dưới dạng OFI hay điểm mạnh sẽ
            bị bỏ qua. Chỉ ép chặt phần QUAN SÁT — phần chung của mọi loại finding.
          */}
          <div className="mt-2 flex gap-2.5 rounded-lg bg-amber-50 px-3 py-2.5">
            <svg
              viewBox="0 0 20 20"
              fill="currentColor"
              className="mt-0.5 h-4 w-4 shrink-0 text-amber-500"
              aria-hidden
            >
              <path d="M10 1a6 6 0 0 0-3.4 10.94c.35.24.57.6.63 1l.1.62c.06.37.38.64.75.64h3.84c.37 0 .69-.27.75-.64l.1-.62c.06-.4.28-.76.63-1A6 6 0 0 0 10 1Z" />
              <path d="M7.5 16.5a.75.75 0 0 1 .75-.75h3.5a.75.75 0 0 1 0 1.5h-3.5a.75.75 0 0 1-.75-.75ZM8.5 18.5a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 0 1.5h-1.5a.75.75 0 0 1-.75-.75Z" />
            </svg>
            <div className="text-sm text-amber-900">
              <p className="font-semibold">Ghi nhận càng cụ thể, finding càng chặt chẽ</p>
              <ul className="mt-1.5 space-y-1">
                <li>• Kiểm tra ở đâu, khi nào</li>
                <li>• Đối tượng và số lượng đã xem xét (mã thiết bị, số hiệu tài liệu, số mẫu)</li>
                <li>• Quan sát được điều gì</li>
                <li>• Nếu có liên quan tới quy định hay thủ tục nào thì nêu tên</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mb-4">
          <label className="label">Nơi phát hiện</label>
          <input className="input" value={area} onChange={(e) => setArea(e.target.value)} />
        </div>

        <div className="mb-5">
          <ImageUploader images={images} onChange={setImages} />
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            onClick={handleStandardize}
            disabled={loading || savingDraft}
            className="btn-primary flex-1"
          >
            {loading ? 'AI đang phân tích…' : 'Chuẩn hoá bằng AI'}
          </button>
          <button
            onClick={handleSaveDraft}
            disabled={loading || savingDraft || rawText.trim().length < 10}
            title="Lưu ghi nhận thô, chuẩn hoá sau"
            className="btn-ghost"
          >
            {savingDraft ? 'Đang lưu…' : 'Lưu nháp'}
          </button>
        </div>


        {error && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}
      </section>

      {/* ---------------- Cột phải: kết quả ---------------- */}
      <section className="card p-5">
        <h2 className="mb-1 text-lg font-semibold">2. Finding đã chuẩn hoá</h2>
        <p className="mb-5 text-sm text-slate-500">
          Rà soát và chỉnh sửa trước khi lưu. AI là trợ lý, quyết định cuối cùng thuộc về bạn.
        </p>

        {loading && <AnalysisProgress hasImages={images.length > 0} />}

        {!loading && !result && (
          <div className="grid h-64 place-items-center rounded-lg border border-dashed border-slate-300 text-sm text-slate-400">
            Kết quả sẽ hiển thị tại đây
          </div>
        )}

        {!loading && result && (
          <div className="space-y-4">
            {warnings.length > 0 && (
              <ul className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {warnings.map((w, i) => (
                  <li key={i}>• {w}</li>
                ))}
              </ul>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge value={result.severity} />
              <select
                value={result.severity}
                onChange={(e) => {
                  const sev = e.target.value as StandardizedFinding['severity'];
                  patch('severity', sev);
                  // Đổi mức độ thì hạn khắc phục tính lại — trừ khi auditor đã tự sửa.
                  if (!dueDateTouched) setDueDate(suggestDueDate(sev));
                }}
                className="rounded-md border border-slate-300 px-2 py-1 text-xs"
              >
                {Object.entries(SEVERITY_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>

            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs italic text-slate-600">
              {result.severityRationale}
            </p>

            <Field label="Tiêu đề">
              <input className="input" value={result.title} onChange={(e) => patch('title', e.target.value)} />
            </Field>

            <Field label="Thời hạn khắc phục">
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  className="input"
                  value={dueDate}
                  onChange={(e) => {
                    setDueDate(e.target.value);
                    setDueDateTouched(true);
                  }}
                />
                {dueDateTouched ? (
                  <button
                    type="button"
                    onClick={() => {
                      setDueDateTouched(false);
                      setDueDate(suggestDueDate(result.severity));
                    }}
                    className="shrink-0 whitespace-nowrap text-xs text-brand-600 hover:underline"
                  >
                    Về mặc định
                  </button>
                ) : (
                  <span className="shrink-0 whitespace-nowrap text-xs text-slate-400">
                    {DUE_DAYS_BY_SEVERITY[result.severity] != null
                      ? `Gợi ý ${DUE_DAYS_BY_SEVERITY[result.severity]} ngày`
                      : 'Không cần khắc phục'}
                  </span>
                )}
              </div>
            </Field>

            <div>
              <label className="label">Điều khoản viện dẫn</label>
              <ul className="space-y-1.5">
                {result.clauses.map((c, i) => (
                  <li key={i} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    <span className="font-medium text-brand-700">{c.standard} — {c.clause}</span>{' '}
                    {c.clauseTitle}
                    {c.reason && <p className="mt-0.5 text-xs text-slate-500">{c.reason}</p>}
                  </li>
                ))}
                {result.clauses.length === 0 && (
                  <li className="text-sm text-slate-400">Không có điều khoản nào được viện dẫn.</li>
                )}
              </ul>
            </div>

            <Field label="Phát biểu finding (dùng trong báo cáo)">
              <textarea
                rows={6}
                className="input"
                value={result.statement}
                onChange={(e) => patch('statement', e.target.value)}
              />
            </Field>

            <Field label="Bằng chứng khách quan — mỗi dòng một mẩu">
              <textarea
                rows={4}
                className="input"
                value={result.evidence.join('\n')}
                onChange={(e) => patch('evidence', e.target.value.split('\n').filter(Boolean))}
              />
            </Field>

            {result.missingInfo.length > 0 && (
              <div className="rounded-lg bg-amber-50 px-3 py-2.5">
                <p className="text-sm font-medium text-amber-900">Auditor cần bổ sung:</p>
                <ul className="mt-1 space-y-0.5 text-sm text-amber-800">
                  {result.missingInfo.map((m, i) => <li key={i}>• {m}</li>)}
                </ul>
              </div>
            )}

            {result.imageNotes.length > 0 && (
              <div className="rounded-lg bg-sky-50 px-3 py-2.5">
                <p className="text-sm font-medium text-sky-900">Ghi chú từ hình ảnh:</p>
                <ul className="mt-1 space-y-0.5 text-sm text-sky-800">
                  {result.imageNotes.map((m, i) => <li key={i}>• {m}</li>)}
                </ul>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button onClick={handleSave} disabled={saving} className="btn-primary flex-1">
                {saving ? 'Đang lưu…' : 'Lưu finding'}
              </button>
              <button onClick={handleStandardize} disabled={loading} className="btn-ghost">
                Chuẩn hoá lại
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}
