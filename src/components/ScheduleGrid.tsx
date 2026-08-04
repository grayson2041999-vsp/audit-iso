'use client';

import { useState } from 'react';
import {
  KIND_LABELS, durationLabel, formatDayLong, toHHMM, toMinutes,
  type Hours, type PlanSession,
} from '@/lib/plan';

type Unit = { id: string; name: string };
type Row = { id: string; label: string; memberId: string | null };

/** Bảng màu xoay vòng cho các đơn vị — cùng đơn vị thì cùng màu ở mọi dòng. */
const UNIT_COLORS = [
  'bg-brand-100 text-brand-900 border-brand-300',
  'bg-emerald-100 text-emerald-900 border-emerald-300',
  'bg-amber-100 text-amber-900 border-amber-300',
  'bg-violet-100 text-violet-900 border-violet-300',
  'bg-sky-100 text-sky-900 border-sky-300',
  'bg-rose-100 text-rose-900 border-rose-300',
  'bg-teal-100 text-teal-900 border-teal-300',
  'bg-orange-100 text-orange-900 border-orange-300',
];

/**
 * Lịch dạng lưới: mỗi đánh giá viên một dòng, trục ngang là thời gian.
 *
 * Nhìn một cái thấy ngay ai đang rảnh, ai kín lịch, chỗ nào chồng chéo, ngày
 * nào còn thừa — thứ mà danh sách theo ngày không cho thấy được.
 *
 * Dòng của một phiên KHÔNG kéo đổi được, vì dòng suy ra từ phân công ở bước
 * Chuẩn bị. Muốn đổi người thì sửa phân công, lưới tự đúng theo. Ở đây chỉ
 * chỉnh giờ và đổi đơn vị.
 */
export function ScheduleGrid({
  days, hours, sessions, units, members, unitMembers, conflictIds, locked,
  onPatch, onRemove,
}: {
  days: string[];
  hours: Hours;
  sessions: PlanSession[];
  units: Unit[];
  members: { id: string; fullName: string; short: string }[];
  unitMembers: Map<string, string[]>;
  conflictIds: Set<string>;
  locked: boolean;
  onPatch: (id: string, patch: Partial<PlanSession>) => void;
  onRemove: (id: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  const dayStart = toMinutes(hours.amStart);
  const dayEnd = toMinutes(hours.pmEnd);
  const span = Math.max(1, dayEnd - dayStart);

  const lunchStart = toMinutes(hours.amEnd);
  const lunchEnd = toMinutes(hours.pmStart);

  const pct = (m: number) => ((m - dayStart) / span) * 100;

  const colorOf = (unitId: string) =>
    UNIT_COLORS[Math.max(0, units.findIndex((u) => u.id === unitId)) % UNIT_COLORS.length];

  /* --- Dòng: mỗi đánh giá viên một dòng, cộng dòng "chưa phân công" nếu cần --- */
  const rows: Row[] = members.map((m) => ({ id: m.id, label: m.short, memberId: m.id }));

  const hasOrphan = sessions.some(
    (s) => s.kind === 'UNIT' && s.unitId && (unitMembers.get(s.unitId) ?? []).length === 0,
  );
  if (hasOrphan) rows.push({ id: 'orphan', label: 'Chưa phân công', memberId: null });

  /* --- Vạch giờ tròn trên trục --- */
  const ticks: number[] = [];
  for (let t = Math.ceil(dayStart / 60) * 60; t <= dayEnd; t += 60) ticks.push(t);

  /** Phiên nào thuộc dòng nào. */
  function sessionsForRow(day: string, row: Row) {
    return sessions.filter((s) => {
      if (s.day !== day) return false;
      if (s.kind !== 'UNIT') return true; // họp thì cả đoàn, hiện ở mọi dòng
      const ms = s.unitId ? unitMembers.get(s.unitId) ?? [] : [];
      return row.memberId ? ms.includes(row.memberId) : ms.length === 0;
    });
  }

  if (rows.length === 0) {
    return (
      <p className="card p-6 text-sm text-slate-500">
        Chưa có đánh giá viên nào. Quay lại bước Chuẩn bị đợt để khai báo.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {days.map((day, dayIndex) => (
        <div key={day} className="rounded-lg border border-slate-200">
          <p className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium">
            Ngày {dayIndex + 1} — {formatDayLong(day)}
          </p>

          <div className="overflow-x-auto">
            <div className="min-w-[760px]">
              {/* --- Trục giờ --- */}
              <div className="flex border-b border-slate-100">
                <div className="w-28 shrink-0 px-3 py-1.5 text-xs text-slate-400">Giờ</div>
                <div className="relative h-6 flex-1">
                  {ticks.map((t) => (
                    <span
                      key={t}
                      className="absolute top-1 -translate-x-1/2 text-[11px] text-slate-400"
                      style={{ left: `${pct(t)}%` }}
                    >
                      {toHHMM(t)}
                    </span>
                  ))}
                </div>
              </div>

              {/* --- Từng dòng đánh giá viên --- */}
              {rows.map((row) => (
                <div key={row.id} className="flex border-b border-slate-100 last:border-0">
                  <div
                    className="w-28 shrink-0 truncate px-3 py-2 text-xs font-medium text-slate-700"
                    title={members.find((m) => m.id === row.id)?.fullName}
                  >
                    {row.label}
                  </div>

                  <div className="relative h-12 flex-1 bg-slate-50/60">
                    {/* Dải nghỉ trưa */}
                    {lunchEnd > lunchStart && (
                      <div
                        className="absolute inset-y-0 bg-slate-200/70"
                        style={{
                          left: `${pct(lunchStart)}%`,
                          width: `${((lunchEnd - lunchStart) / span) * 100}%`,
                        }}
                        title="Nghỉ trưa"
                      />
                    )}

                    {/* Vạch giờ mờ */}
                    {ticks.map((t) => (
                      <div
                        key={t}
                        className="absolute inset-y-0 w-px bg-slate-200/80"
                        style={{ left: `${pct(t)}%` }}
                      />
                    ))}

                    {sessionsForRow(day, row).map((s) => {
                      const a = toMinutes(s.startTime);
                      const b = toMinutes(s.endTime);
                      const bad = conflictIds.has(s.id);
                      const unit = s.unitId ? units.find((u) => u.id === s.unitId) : null;

                      const cls =
                        s.kind !== 'UNIT'
                          ? 'bg-slate-800 text-white border-slate-900'
                          : s.unitId
                            ? colorOf(s.unitId)
                            : 'bg-slate-100 text-slate-600 border-slate-300';

                      return (
                        <button
                          key={s.id}
                          onClick={() => setOpenId(openId === s.id ? null : s.id)}
                          title={`${s.startTime}–${s.endTime} · ${
                            s.kind === 'UNIT' ? unit?.name ?? '—' : KIND_LABELS[s.kind]
                          }`}
                          className={`absolute top-1 bottom-1 overflow-hidden rounded border px-1.5 text-left text-[11px] leading-tight transition ${cls} ${
                            bad ? 'ring-2 ring-red-500' : ''
                          } ${openId === s.id ? 'ring-2 ring-brand-500' : ''}`}
                          style={{
                            left: `${pct(a)}%`,
                            width: `${Math.max(1.5, ((b - a) / span) * 100)}%`,
                          }}
                        >
                          <span className="block truncate font-medium">
                            {s.kind === 'UNIT' ? unit?.name ?? '(đã xoá)' : KIND_LABELS[s.kind]}
                          </span>
                          <span className="block truncate opacity-70">
                            {s.startTime}–{s.endTime}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* --- Khối sửa cho phiên đang chọn trong ngày này --- */}
          {openId && sessions.some((s) => s.id === openId && s.day === day) && !locked && (
            <SessionEditor
              session={sessions.find((s) => s.id === openId)!}
              units={units}
              onPatch={onPatch}
              onRemove={(id) => {
                onRemove(id);
                setOpenId(null);
              }}
              onClose={() => setOpenId(null)}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function SessionEditor({
  session, units, onPatch, onRemove, onClose,
}: {
  session: PlanSession;
  units: Unit[];
  onPatch: (id: string, patch: Partial<PlanSession>) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3 border-t border-slate-200 bg-brand-50/40 px-3 py-3 text-sm">
      <div>
        <span className="mb-1 block text-xs text-slate-500">Bắt đầu</span>
        <input
          type="time"
          step={900}
          value={session.startTime}
          onChange={(e) => onPatch(session.id, { startTime: e.target.value })}
          className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
        />
      </div>
      <div>
        <span className="mb-1 block text-xs text-slate-500">Kết thúc</span>
        <input
          type="time"
          step={900}
          value={session.endTime}
          onChange={(e) => onPatch(session.id, { endTime: e.target.value })}
          className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
        />
      </div>
      <span className="pb-2 text-xs text-slate-500">
        {durationLabel(session.startTime, session.endTime)}
      </span>

      {session.kind === 'UNIT' && (
        <div className="min-w-[12rem] flex-1">
          <span className="mb-1 block text-xs text-slate-500">Đơn vị</span>
          <select
            value={session.unitId ?? ''}
            onChange={(e) => onPatch(session.id, { unitId: e.target.value })}
            className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          >
            {units.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>
      )}

      <button onClick={() => onRemove(session.id)} className="pb-2 text-xs text-red-600 hover:underline">
        Bỏ phiên
      </button>
      <button onClick={onClose} className="pb-2 text-xs text-slate-500 hover:underline">
        Đóng
      </button>
    </div>
  );
}
