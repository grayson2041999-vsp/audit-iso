'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ImageUploader, type UploadedImage } from './ImageUploader';
import { AnalysisProgress } from './AnalysisProgress';
import { SeverityBadge } from './Badge';
import { STANDARD_LABELS, SEVERITY_LABELS, type StandardCode } from '@/lib/iso';
import type { StandardizedFinding } from '@/lib/types';

const STANDARDS = Object.keys(STANDARD_LABELS) as StandardCode[];

const EXAMPLE = `Kho vật tư tầng 1: kiểm tra 8 bình chữa cháy, thấy 3 bình (BCC-04, BCC-07, BCC-11) tem kiểm định hết hạn từ 02/2026. Hỏi thủ kho thì không xuất trình được sổ theo dõi kiểm tra hàng tháng 6 tháng gần đây. Thủ tục QT-PCCC-01 mục 5.3 yêu cầu kiểm tra hàng tháng và ghi sổ.`;

export function FindingWorkbench() {
  const router = useRouter();

  const [rawText, setRawText] = useState('');
  const [standards, setStandards] = useState<StandardCode[]>(['ISO9001']);
  const [area, setArea] = useState('');
  const [process, setProcess] = useState('');
  const [auditee, setAuditee] = useState('');
  const [auditorName, setAuditorName] = useState('');
  const [images, setImages] = useState<UploadedImage[]>([]);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [result, setResult] = useState<StandardizedFinding | null>(null);

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
          rawText, standards, area, process, auditee, auditorName,
          imageKeys: images.map((i) => i.key),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Chuẩn hoá thất bại.');
      setResult(data.result);
      setWarnings(data.warnings ?? []);
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
      const res = await fetch('/api/findings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawText, standards, area, process, auditorName,
          ai: result,
          images: images.map((i) => ({
            key: i.key, fileName: i.fileName, contentType: i.contentType, size: i.size,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Lưu thất bại.');
      router.push(`/findings/${data.finding.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lỗi khi lưu.');
      setSaving(false);
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
        <p className="mb-5 text-sm text-slate-500">
          Viết tự nhiên, gạch đầu dòng cũng được. AI sẽ chuẩn hoá theo cấu trúc R–N–E của ISO.
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
          <div className="mb-1.5 flex items-baseline justify-between">
            <label className="label !mb-0">Nội dung ghi nhận *</label>
            <button
              type="button"
              onClick={() => setRawText(EXAMPLE)}
              className="text-xs text-brand-600 hover:underline"
            >
              Dùng ví dụ mẫu
            </button>
          </div>
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            rows={9}
            className="input font-normal"
            placeholder="VD: Kiểm tra khu vực kho hoá chất, thấy 2 thùng dung môi không có nhãn nhận diện, không có MSDS tại chỗ…"
          />
          <p className="mt-1 text-xs text-slate-400">
            Mẹo: nêu càng cụ thể số hiệu tài liệu, mã thiết bị, ngày tháng, số mẫu kiểm tra thì finding càng chặt chẽ.
          </p>
        </div>

        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Khu vực / bộ phận</label>
            <input className="input" value={area} onChange={(e) => setArea(e.target.value)} placeholder="Kho vật tư tầng 1" />
          </div>
          <div>
            <label className="label">Quá trình liên quan</label>
            <input className="input" value={process} onChange={(e) => setProcess(e.target.value)} placeholder="Quản lý PCCC" />
          </div>
          <div>
            <label className="label">Đơn vị được đánh giá</label>
            <input className="input" value={auditee} onChange={(e) => setAuditee(e.target.value)} placeholder="Phòng Vật tư" />
          </div>
          <div>
            <label className="label">Auditor</label>
            <input className="input" value={auditorName} onChange={(e) => setAuditorName(e.target.value)} placeholder="Nguyễn Văn A" />
          </div>
        </div>

        <div className="mb-5">
          <ImageUploader images={images} onChange={setImages} />
        </div>

        <button onClick={handleStandardize} disabled={loading} className="btn-primary w-full">
          {loading ? 'AI đang phân tích…' : 'Chuẩn hoá bằng AI'}
        </button>

        {error && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}
      </section>

      {/* ---------------- Cột phải: kết quả ---------------- */}
      <section className="card p-5">
        <h2 className="mb-1 text-lg font-semibold">2. Finding đã chuẩn hoá</h2>
        <p className="mb-5 text-sm text-slate-500">
          Auditor rà soát và chỉnh sửa trước khi lưu. AI là trợ lý, quyết định cuối cùng thuộc về auditor.
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
                onChange={(e) => patch('severity', e.target.value as StandardizedFinding['severity'])}
                className="rounded-md border border-slate-300 px-2 py-1 text-xs"
              >
                {Object.entries(SEVERITY_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
              <span className="ml-auto text-xs text-slate-500">Độ tin cậy: {result.confidence}%</span>
            </div>

            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs italic text-slate-600">
              {result.severityRationale}
            </p>

            <Field label="Tiêu đề">
              <input className="input" value={result.title} onChange={(e) => patch('title', e.target.value)} />
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

            <div className="grid gap-3">
              <Field label="Yêu cầu (Requirement)">
                <textarea rows={3} className="input" value={result.requirement} onChange={(e) => patch('requirement', e.target.value)} />
              </Field>
              <Field label="Sự không phù hợp (Nonconformity)">
                <textarea rows={3} className="input" value={result.nonconformity} onChange={(e) => patch('nonconformity', e.target.value)} />
              </Field>
              <Field label="Bằng chứng khách quan (Evidence)">
                <textarea
                  rows={4}
                  className="input"
                  value={result.evidence.join('\n')}
                  onChange={(e) => patch('evidence', e.target.value.split('\n').filter(Boolean))}
                />
              </Field>
            </div>

            <details className="rounded-lg border border-slate-200 p-3">
              <summary className="cursor-pointer text-sm font-medium">Phân tích rủi ro & định hướng khắc phục</summary>
              <div className="mt-3 space-y-3">
                <Field label="Rủi ro tiềm ẩn">
                  <textarea rows={3} className="input" value={result.riskAnalysis} onChange={(e) => patch('riskAnalysis', e.target.value)} />
                </Field>
                <Field label="Định hướng hành động khắc phục">
                  <textarea rows={3} className="input" value={result.suggestedAction} onChange={(e) => patch('suggestedAction', e.target.value)} />
                </Field>
              </div>
            </details>

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
