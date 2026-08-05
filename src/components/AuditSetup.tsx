'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AuditMember, AuditUnit } from '@/lib/schema';
import { buildShortNames, sameUnitName } from '@/lib/utils';
import { computeCapacity, durationLabel, listDays, toHHMM } from '@/lib/plan';
import { autoAssign } from '@/lib/assign';

type Props = {
  auditId: string;
  status: string;
  units: AuditUnit[];
  members: AuditMember[];
  /** Cặp "memberId:unitId" đã phân công. */
  links: string[];
  publicUrl: string;
  leaderName: string;
  /** Dùng để tính trước quỹ thời gian ngay tại bước phân công. */
  startDate: string | null;
  endDate: string | null;
  hours: {
    amStart: string; amEnd: string; pmStart: string; pmEnd: string;
    openingMinutes: number; closingMinutes: number;
  };
  /** Khung giờ riêng của từng ngày, theo thứ tự ngày trong đợt. */
  dayHours: { amStart: string; amEnd: string; pmStart: string; pmEnd: string }[];
};

export function AuditSetup({
  auditId, status, units, members, links, publicUrl, leaderName, startDate, endDate, hours,
  dayHours,
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
  /**
   * Quỹ thời gian tính ngay tại đây, cập nhật theo từng ô tick.
   * Trưởng đoàn thấy được hệ quả của việc phân công và của số ngày đã chọn
   * trước khi sang bước lập chương trình.
   */
  const capacity = useMemo(() => {
    const unitMembers = new Map<string, string[]>();
    for (const key of linkSet) {
      const [memberId, unitId] = key.split(':');
      unitMembers.set(unitId, [...(unitMembers.get(unitId) ?? []), memberId]);
    }
    const list = listDays(startDate, endDate);
    return computeCapacity({
      days: list,
      // Ngày nào đã khai khung giờ riêng thì dùng của ngày đó.
      hoursOf: (day) => ({
        ...(dayHours[list.indexOf(day)] ?? hours),
        openingMinutes: hours.openingMinutes,
        closingMinutes: hours.closingMinutes,
      }),
      units: units.map((u) => ({ id: u.id })),
      unitMembers,
    });
  }, [linkSet, startDate, endDate, hours, dayHours, units]);

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

      {/* ============ Mã truy cập — việc quay lại nhiều nhất sau khi mở đợt ============ */}
      {opened && (
        <section className="rounded-xl border-2 border-brand-300 bg-brand-50/50 p-5">
          <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-lg font-semibold text-brand-900">Link và mã truy cập</h2>
            <span className="text-sm text-brand-700">
              Gửi link cho cả đoàn, kèm mã riêng của từng người
            </span>
          </div>

          <CopyLink url={publicUrl} />

          <ul className="mt-4 divide-y divide-brand-100 overflow-hidden rounded-lg border border-brand-200 bg-white">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <span className={`flex-1 ${m.fullName === leaderName ? 'font-semibold' : 'font-medium'}`}>
                  {m.fullName}
                  {m.fullName === leaderName && (
                    <span className="ml-2 text-xs font-normal text-slate-500">trưởng đoàn</span>
                  )}
                </span>
                <span className="hidden text-xs text-slate-400 sm:inline">
                  {units.filter((u) => linkSet.has(`${m.id}:${u.id}`)).length} đơn vị
                </span>
                {m.accessCode ? (
                  <CopyCode code={m.accessCode} memberName={m.fullName} />
                ) : (
                  <span className="text-slate-400">—</span>
                )}
              </li>
            ))}
          </ul>

          <p className="mt-3 text-xs text-brand-800">
            Sửa phân công bên dưới rồi bấm Lưu là đánh giá viên thấy ngay đơn vị mới ở lần mở
            trang sau — mã giữ nguyên, không phải gửi lại. Thêm người sau khi mở đợt thì họ được
            cấp mã ngay.
          </p>
        </section>
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

        {units.length > 0 && members.length > 0 && !locked && (
          <AutoAssignRow
            units={units.map((u) => ({ id: u.id, name: u.name }))}
            members={members.map((m) => ({
              id: m.id,
              fullName: m.fullName,
              homeUnit: m.homeUnit,
            }))}
            hasExisting={linkSet.size > 0}
            onApply={(pairs) => setLinkSet(new Set(pairs))}
          />
        )}

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

        {units.length > 0 && capacity.dayCount > 0 && (
          <div
            className={`mt-4 rounded-lg px-3 py-2.5 text-sm ${
              capacity.atFloor ? 'bg-amber-50 text-amber-900' : 'bg-slate-50 text-slate-700'
            }`}
          >
            <strong>{capacity.unitCount} đơn vị</strong> · {capacity.dayCount} ngày · quỹ{' '}
            {capacity.availableMinutes} phút →{' '}
            <strong>
              mỗi đơn vị {durationLabel('00:00', toHHMM(capacity.perUnitMinutes))}
            </strong>
            <span className="block text-xs">
              {capacity.mode === 'SEQUENTIAL'
                ? 'Chưa phân công ai — cả đoàn đi cùng nhau, quỹ chia cho số đơn vị. Tick phân công để các đánh giá viên làm song song, mỗi đơn vị sẽ được nhiều thời gian hơn.'
                : `Đã phân công — quỹ chia cho ${capacity.divisor} vòng của đánh giá viên bận nhất.`}
              {capacity.atFloor && ' Không đủ thời gian: cân nhắc thêm ngày hoặc thêm đánh giá viên.'}
            </span>
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
      {!opened && (
      <section className="card p-5">
        <h2 className="font-semibold">4. Mở đợt đánh giá</h2>

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
      </section>
      )}
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

/**
 * Phân công tự động — chia đều đơn vị cho cả đoàn.
 *
 * Kết quả chỉ điền vào ma trận bên dưới để xem trước; phải bấm Lưu phân công
 * thì mới có hiệu lực. Trưởng đoàn sửa lại ô nào cũng được trước khi lưu.
 */
function AutoAssignRow({
  units, members, hasExisting, onApply,
}: {
  units: { id: string; name: string }[];
  members: { id: string; fullName: string; homeUnit: string | null }[];
  hasExisting: boolean;
  onApply: (pairs: string[]) => void;
}) {
  const [perUnit, setPerUnit] = useState(1);
  const [note, setNote] = useState<{ text: string; warn: string | null } | null>(null);

  function run() {
    if (
      hasExisting &&
      !confirm('Phân công tự động sẽ thay thế toàn bộ các ô đang tick. Tiếp tục?')
    ) {
      return;
    }

    const r = autoAssign({ units, members, auditorsPerUnit: perUnit });
    onApply(r.pairs);

    const spread =
      r.minLoad === r.maxLoad ? `mỗi người ${r.maxLoad} đơn vị` : `mỗi người ${r.minLoad}–${r.maxLoad} đơn vị`;

    setNote({
      text: `Đã chia ${units.length} đơn vị cho ${members.length} đánh giá viên — ${spread}. Xem lại ma trận bên dưới rồi bấm Lưu phân công.`,
      warn:
        r.selfAudited.length > 0
          ? `Không đủ người độc lập cho: ${r.selfAudited.join(', ')}. ` +
            'Những đơn vị này đang có người của chính đơn vị đó — nên đổi tay nếu được.'
          : null,
    });
  }

  return (
    <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button type="button" onClick={run} className="btn-ghost bg-white">
          Phân công tự động
        </button>
        <label className="flex items-center gap-2 text-slate-600">
          Mỗi đơn vị
          <input
            type="number"
            min={1}
            max={Math.max(1, members.length)}
            value={perUnit}
            onChange={(e) => setPerUnit(Math.max(1, Number(e.target.value) || 1))}
            className="w-16 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          />
          đánh giá viên
        </label>
        <span className="text-xs text-slate-500">
          Chia đều tải, tránh xếp người vào chính đơn vị họ đang công tác.
        </span>
      </div>

      {note && (
        <div className="mt-2 space-y-1">
          <p className="text-xs text-slate-600">{note.text}</p>
          {note.warn && <p className="text-xs text-amber-700">{note.warn}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * Mã truy cập kèm nút chép nhanh.
 *
 * Trưởng đoàn phải gửi mã riêng cho từng người qua Zalo — bôi đen 6 chữ số rồi
 * copy tay, làm 10 lần liên tiếp rất dễ chép nhầm dòng. Nút này chép đúng mã của
 * đúng dòng đó.
 */
function CopyCode({ code, memberName }: { code: string; memberName: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      title={`Chép mã của ${memberName}`}
      aria-label={`Chép mã của ${memberName}`}
      className={`inline-flex items-center gap-2 rounded px-2.5 py-1 font-mono transition ${
        copied
          ? 'bg-emerald-50 text-emerald-700'
          : 'bg-brand-50 text-brand-700 hover:bg-brand-100'
      }`}
    >
      {copied ? (
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5 shrink-0">
          <path
            fillRule="evenodd"
            d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0l-3.5-3.5a1 1 0 1 1 1.4-1.4l2.8 2.8 6.8-6.8a1 1 0 0 1 1.4 0Z"
            clipRule="evenodd"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5 shrink-0">
          <path d="M7 3a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V6.4a2 2 0 0 0-.6-1.4l-1.4-1.4a2 2 0 0 0-1.4-.6H7Z" />
          <path d="M4 6a1 1 0 0 0-1 1v8a2 2 0 0 0 2 2h6a1 1 0 1 0 0-2H5V7a1 1 0 0 0-1-1Z" />
        </svg>
      )}
      {code}
    </button>
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
