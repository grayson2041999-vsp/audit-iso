'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type UnitCode = { id: string; name: string; code: string | null; ncCount: number };

/**
 * Hộp "Gửi báo cáo cho đơn vị" nằm dưới bảng tổng hợp finding.
 *
 * Ba trạng thái, ba giao diện khác nhau:
 *   · Đợt chưa khoá  → giải thích vì sao chưa gửi được
 *   · Chưa phát hành → nút gửi + đếm trước xem gửi cho mấy đơn vị
 *   · Đã phát hành   → bảng link kèm mã để trưởng đoàn copy gửi qua Zalo/email
 */
export function IssueReportBox({
  auditId,
  closed,
  version,
  issuedAt,
  units,
  baseUrl,
}: {
  auditId: string;
  closed: boolean;
  version: number;
  issuedAt: string | null;
  units: UnitCode[];
  baseUrl: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const issued = Boolean(issuedAt);
  const link = `${baseUrl}/bao-cao/${auditId}`;
  const unitsWithNc = units.filter((u) => u.ncCount > 0).length;

  async function publish() {
    let reason = '';

    if (!issued) {
      if (
        !confirm(
          `Gửi báo cáo cho ${units.length} đơn vị?\n\n` +
            `${unitsWithNc} đơn vị có sự không phù hợp sẽ phải nộp hồ sơ khắc phục.\n\n` +
            'Mỗi đơn vị nhận một mã 8 số. Bạn tự gửi link kèm mã cho họ.',
        )
      ) {
        return;
      }
    } else {
      const input = prompt(
        `Phát hành bản ${version + 1}?\n\n` +
          'Đơn vị đang xem bản ' +
          version +
          '. Sau khi phát hành họ sẽ thấy bản mới và thấy cả lý do bạn nhập ở đây.\n\n' +
          'Lý do phát hành lại:',
      );
      if (input === null) return;
      reason = input.trim();
      if (reason.length < 5) {
        setError('Lý do quá ngắn.');
        return;
      }
    }

    setBusy(true);
    setError(null);
    const res = await fetch(`/api/audits/${auditId}/phat-hanh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? 'Không phát hành được.');
    router.refresh();
  }

  async function revoke() {
    if (
      !confirm(
        'Thu hồi phát hành?\n\nĐơn vị sẽ không truy cập được nữa. ' +
          'Mã và hồ sơ vẫn giữ nguyên, phát hành lại là dùng tiếp được.',
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/audits/${auditId}/phat-hanh`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? 'Không thu hồi được.');
    router.refresh();
  }

  function copy(text: string, tag: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(tag);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  /* ---------- Chưa khoá ---------- */
  if (!closed && !issued) {
    return (
      <div className="card p-5">
        <h3 className="font-semibold">Gửi báo cáo cho đơn vị</h3>
        <p className="mt-1.5 text-sm text-slate-500">
          Khoá đợt trước đã. Gửi một báo cáo mà đánh giá viên còn đang nhập dở là gửi một
          thứ chưa xong.
        </p>
      </div>
    );
  }

  /* ---------- Đã khoá, chưa gửi ---------- */
  if (!issued) {
    return (
      <div className="card p-5">
        <h3 className="font-semibold">Gửi báo cáo cho đơn vị</h3>
        <p className="mt-1.5 text-sm text-slate-600">
          Tạo bản phát hành và cấp mã 8 số cho {units.length} đơn vị.{' '}
          {unitsWithNc > 0 ? (
            <>
              <strong>{unitsWithNc}</strong> đơn vị có sự không phù hợp sẽ phải nộp hồ sơ khắc phục;
              số còn lại chỉ xem báo cáo.
            </>
          ) : (
            'Đợt này không có sự không phù hợp nào nên không đơn vị nào phải nộp hồ sơ khắc phục.'
          )}
        </p>
        <button onClick={publish} disabled={busy} className="btn-primary mt-4">
          {busy ? 'Đang gửi…' : 'Gửi báo cáo cho đơn vị'}
        </button>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  /* ---------- Đã gửi ---------- */
  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">Đã gửi cho đơn vị — bản {version}</h3>
          <p className="mt-1 text-sm text-slate-500">
            Đơn vị đang xem bản {version}. Sửa finding thì phải phát hành bản mới họ mới thấy.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={revoke} disabled={busy} className="btn-ghost">
            Thu hồi
          </button>
          <button onClick={publish} disabled={busy} className="btn-primary">
            {busy ? 'Đang xử lý…' : `Phát hành bản ${version + 1}`}
          </button>
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-4 rounded-lg bg-slate-50 p-3">
        <p className="text-xs font-medium text-slate-500">Link chung cho mọi đơn vị</p>
        <div className="mt-1 flex items-center gap-2">
          <code className="flex-1 truncate text-sm font-semibold text-slate-900">{link}</code>
          <button onClick={() => copy(link, 'link')} className="btn-ghost px-2 py-1 text-xs">
            {copied === 'link' ? 'Đã chép' : 'Chép'}
          </button>
        </div>
      </div>

      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase text-slate-700">
            <th className="pb-2">Đơn vị</th>
            <th className="pb-2 text-center">NC</th>
            <th className="pb-2">Mã 8 số</th>
            <th className="pb-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {units.map((u) => (
            <tr key={u.id}>
              <td className="py-2">{u.name}</td>
              <td className="py-2 text-center tabular-nums text-slate-500">
                {u.ncCount || '—'}
              </td>
              <td className="py-2 font-mono tracking-widest">{u.code ?? '—'}</td>
              <td className="py-2 text-right">
                <button
                  onClick={() => copy(u.code ?? '', u.id)}
                  disabled={!u.code}
                  className="btn-ghost px-2 py-1 text-xs"
                >
                  {copied === u.id ? 'Đã chép' : 'Chép mã'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

    </div>
  );
}
