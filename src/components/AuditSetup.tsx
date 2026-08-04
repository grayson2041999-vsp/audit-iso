'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AuditMember, AuditUnit } from '@/lib/schema';
import { buildShortNames, sameUnitName } from '@/lib/utils';

type Props = {
  auditId: string;
  status: string;
  units: AuditUnit[];
  members: AuditMember[];
  /** Cặp "memberId:unitId" đã phân công. */
  links: string[];
  publicUrl: string;
  leaderName: string;
};

export function AuditSetup({
  auditId, status, units, members, links, publicUrl, leaderName,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Ma trận phân công giữ hoàn toàn ở phía trình duyệt cho tới khi bấm Lưu.
   * Trước đây mỗi ô tick là một yêu cầu mạng kèm dựng lại cả trang — bấm phát
   * nào chờ phát đó. Giờ tick tức thì, chỉ tốn một lượt gửi khi lưu.
   */
  const [linkSet, setLinkSet] = useState<Set<string>>(() => new Set(links));
  const savedKey = links.slice().sort().join('|');

  // Đồng bộ lại khi dữ liệu máy chủ đổi (thêm/xoá đơn vị, đánh giá viên…).
  useEffect(() => {
    setLinkSet(new Set(savedKey ? savedKey.split('|') : []));
  }, [savedKey]);

  const dirty = useMemo(() => {
    const now = [...linkSet].sort().join('|');
    return now !== savedKey;
  }, [linkSet, savedKey]);

  function toggleLink(memberId: string, unitId: string, on: boolean) {
    const key = `${memberId}:${unitId}`;
    setLinkSet((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  async function saveAssignments() {
    const pairs = [...linkSet].map((k) => {
      const [memberId, unitId] = k.split(':');
      return { memberId, unitId };
    });
    return call(`/api/audits/${auditId}/assignments`, {
      method: 'PUT',
      body: JSON.stringify({ pairs }),
    });
  }

  /** Tên viết tắt cho hàng tiêu đề ma trận: "Lê Hữu Hoàng Sơn" → "L.H.H. Sơn". */
  const shortNames = useMemo(
    () => buildShortNames(members.map((m) => m.fullName)),
    [members],
  );

  const locked = status === 'CLOSED';
  const opened = status !== 'PLANNED';

  async function call(url: string, init?: RequestInit) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        ...init,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Thao tác thất bại.');
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lỗi không xác định.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  /* ---------------- Điều kiện mở đợt ---------------- */

  const unitsWithoutMember = units.filter(
    (u) => !members.some((m) => linkSet.has(`${m.id}:${u.id}`)),
  );
  const canOpen =
    units.length > 0 &&
    members.length > 0 &&
    unitsWithoutMember.length === 0 &&
    !dirty && // chưa lưu phân công thì chưa cho mở đợt
    !locked;

  return (
    <div className="space-y-6">
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p>
      )}

      {locked && (
        <p className="rounded-lg bg-zinc-100 px-3 py-2.5 text-sm text-zinc-700">
          Đợt đã khoá. Không thêm, sửa hay xoá được nữa.
        </p>
      )}

      {/* ============ 1. Đơn vị được đánh giá ============ */}
      <section className="card p-5">
        <h2 className="mb-4 font-semibold">1. Đơn vị được đánh giá</h2>

        {!locked && (
          <AddRow
            placeholder="Tên đơn vị, VD: Phòng Kỹ thuật – Vật tư"
            busy={busy}
            onAdd={(name) =>
              call(`/api/audits/${auditId}/units`, {
                method: 'POST',
                body: JSON.stringify({ name }),
              })
            }
          />
        )}

        {units.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">Chưa có đơn vị nào.</p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {units.map((u) => {
              const count = members.filter((m) => linkSet.has(`${m.id}:${u.id}`)).length;
              return (
                <li key={u.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                  <span className="flex-1 font-medium">{u.name}</span>
                  <span
                    className={
                      count === 0
                        ? 'chip bg-amber-100 text-amber-800 ring-transparent'
                        : 'chip bg-slate-100 text-slate-600 ring-transparent'
                    }
                  >
                    {count === 0 ? 'Chưa có đánh giá viên' : `${count} đánh giá viên`}
                  </span>
                  {!locked && (
                    <button
                      onClick={() =>
                        confirm(`Xoá đơn vị "${u.name}"? Phân công liên quan cũng bị xoá.`) &&
                        call(`/api/audits/${auditId}/units/${u.id}`, { method: 'DELETE' })
                      }
                      disabled={busy}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Xoá
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ============ 2. Đánh giá viên ============ */}
      <section className="card p-5">
        <h2 className="mb-4 font-semibold">2. Đánh giá viên</h2>

        {!locked && (
          <>
            <AddMemberRow
              busy={busy}
              onAdd={(fullName, homeUnit) =>
                call(`/api/audits/${auditId}/members`, {
                  method: 'POST',
                  body: JSON.stringify({ fullName, homeUnit }),
                })
              }
            />

            {!members.some((m) => m.fullName === leaderName) && (
              <button
                onClick={() =>
                  call(`/api/audits/${auditId}/members`, {
                    method: 'POST',
                    body: JSON.stringify({ fullName: leaderName, isLeader: true }),
                  })
                }
                disabled={busy}
                className="mt-2 text-sm text-brand-600 hover:underline"
              >
                + Thêm tôi ({leaderName}) vào đoàn đánh giá
              </button>
            )}
          </>
        )}

        {members.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">Chưa có đánh giá viên nào.</p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <span className="font-medium">{m.fullName}</span>
                {m.homeUnit && <span className="text-xs text-slate-500">{m.homeUnit}</span>}
                <span className="chip bg-slate-100 text-slate-600 ring-transparent">
                  {units.filter((u) => linkSet.has(`${m.id}:${u.id}`)).length} đơn vị
                </span>
                <span className="ml-auto font-mono text-xs">
                  {m.accessCode ? (
                    <span className="rounded bg-brand-50 px-2 py-1 text-brand-700">
                      {m.accessCode}
                    </span>
                  ) : (
                    <span className="text-slate-400">chưa cấp mã</span>
                  )}
                </span>
                {!locked && (
                  <button
                    onClick={() =>
                      confirm(`Xoá đánh giá viên "${m.fullName}"?`) &&
                      call(`/api/audits/${auditId}/members/${m.id}`, { method: 'DELETE' })
                    }
                    disabled={busy}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Xoá
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ============ 3. Phân công ============ */}
      <section className="card p-5">
        <h2 className="mb-4 font-semibold">3. Phân công</h2>

        {units.length === 0 || members.length === 0 ? (
          <p className="text-sm text-slate-400">
            Cần khai báo xong đơn vị và đánh giá viên ở hai bước trên.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-white px-3 py-2 text-left font-medium text-slate-500">
                    Đơn vị \ Đánh giá viên
                  </th>
                  {members.map((m, i) => (
                    <th key={m.id} className="px-3 py-2 text-center font-medium">
                      <span className="block whitespace-nowrap" title={m.fullName}>
                        {shortNames[i]}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {units.map((u) => (
                  <tr key={u.id}>
                    <td className="sticky left-0 z-10 min-w-[12rem] max-w-[18rem] bg-white px-3 py-2 font-medium">
                      {u.name}
                    </td>
                    {members.map((m) => {
                      const on = linkSet.has(`${m.id}:${u.id}`);
                      const selfAudit = sameUnitName(m.homeUnit, u.name);
                      return (
                        <td key={m.id} className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={busy || locked}
                            title={
                              selfAudit
                                ? `${m.fullName} đang công tác tại ${u.name} — không nên tự đánh giá đơn vị mình`
                                : m.fullName
                            }
                            onChange={(e) => toggleLink(m.id, u.id, e.target.checked)}
                            className={`h-4 w-4 accent-brand-600 ${
                              selfAudit && on ? 'rounded ring-2 ring-amber-400' : ''
                            }`}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {units.length > 0 && members.length > 0 && !locked && (
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
            <button
              onClick={saveAssignments}
              disabled={!dirty || busy}
              className="btn-primary"
            >
              {busy ? 'Đang lưu…' : dirty ? 'Lưu phân công' : 'Đã lưu'}
            </button>

            {dirty && (
              <>
                <span className="text-sm text-amber-600">Có thay đổi chưa lưu</span>
                <button
                  onClick={() => setLinkSet(new Set(savedKey ? savedKey.split('|') : []))}
                  disabled={busy}
                  className="text-sm text-slate-500 hover:underline"
                >
                  Hoàn tác
                </button>
              </>
            )}

          </div>
        )}
      </section>

      {/* ============ 4. Mở đợt ============ */}
      <section className="card p-5">
        <h2 className="font-semibold">4. {opened ? 'Mã truy cập' : 'Mở đợt đánh giá'}</h2>

        {!opened ? (
          <>
            <p className="mb-4 mt-1 text-sm text-slate-500">
              Sinh mã 6 số cho từng đánh giá viên và chuyển đợt sang <strong>Đang thực hiện</strong>.
            </p>

            {unitsWithoutMember.length > 0 && (
              <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                Chưa phân công đánh giá viên cho:{' '}
                <strong>{unitsWithoutMember.map((u) => u.name).join(', ')}</strong>
              </p>
            )}

            {dirty && (
              <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                Bấm <strong>Lưu phân công</strong> ở bước 3 trước đã — phân công chưa lưu
                thì đánh giá viên sẽ không thấy đơn vị nào.
              </p>
            )}

            <button
              onClick={() => call(`/api/audits/${auditId}/mo-dot`, { method: 'POST' })}
              disabled={!canOpen || busy}
              className="btn-primary"
            >
              {busy ? 'Đang xử lý…' : 'Sinh mã & mở đợt'}
            </button>
          </>
        ) : (
          <>
            <p className="mb-4 mt-1 text-sm text-slate-500">
              Gửi đường link dưới đây cho cả đoàn, kèm mã riêng của từng người. Mã luôn xem
              lại được ở trang này nếu ai đó quên.
            </p>

            <CopyLink url={publicUrl} />

            <ul className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {members.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                  <span className="flex-1 font-medium">{m.fullName}</span>
                  <span className="rounded bg-brand-50 px-2.5 py-1 font-mono text-brand-700">
                    {m.accessCode ?? '—'}
                  </span>
                </li>
              ))}
            </ul>

            <p className="mt-3 text-xs text-slate-400">
              Thêm đánh giá viên sau khi đã mở đợt thì họ được cấp mã ngay, không phải mở lại.
            </p>
          </>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function AddRow({
  placeholder, busy, onAdd,
}: {
  placeholder: string;
  busy: boolean;
  onAdd: (value: string) => Promise<boolean>;
}) {
  const [value, setValue] = useState('');
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!value.trim()) return;
        if (await onAdd(value.trim())) setValue('');
      }}
      className="flex gap-2"
    >
      <input
        className="input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
      />
      <button type="submit" disabled={busy || !value.trim()} className="btn-ghost shrink-0">
        Thêm
      </button>
    </form>
  );
}

function AddMemberRow({
  busy, onAdd,
}: {
  busy: boolean;
  onAdd: (fullName: string, homeUnit: string) => Promise<boolean>;
}) {
  const [name, setName] = useState('');
  const [home, setHome] = useState('');
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        if (await onAdd(name.trim(), home.trim())) {
          setName('');
          setHome('');
        }
      }}
      className="flex flex-wrap gap-2"
    >
      <input
        className="input flex-1"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Họ tên đánh giá viên"
      />
      <input
        className="input flex-1"
        value={home}
        onChange={(e) => setHome(e.target.value)}
        placeholder="Đơn vị công tác (không bắt buộc)"
      />
      <button type="submit" disabled={busy || !name.trim()} className="btn-ghost shrink-0">
        Thêm
      </button>
    </form>
  );
}

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      <input readOnly value={url} className="input font-mono text-xs" />
      <button
        type="button"
        onClick={() => {
          navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="btn-ghost shrink-0"
      >
        {copied ? 'Đã chép' : 'Chép link'}
      </button>
    </div>
  );
}
