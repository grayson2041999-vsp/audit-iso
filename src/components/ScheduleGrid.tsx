'use client';

import { useEffect, useRef, useState } from 'react';
import {
  KIND_LABELS, MANUAL_STEP, MIN_MANUAL, STEP, blockedSpans, durationLabel, formatDayLong,
  freeSpans, nearestStart, resizeLimit, snapManual, toHHMM, toMinutes,
  type Hours, type HoursOf, type PlanSession, type Span,
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

/** Bề rộng vùng bấm để kéo mép, tính bằng pixel. */
const EDGE = 7;
/** Di chuyển dưới ngưỡng này coi như bấm chọn, không phải kéo. */
const CLICK_SLOP = 3;

type Drag = {
  id: string;
  mode: 'move' | 'start' | 'end';
  pointerX: number;
  laneWidth: number;
  origStart: number;
  origEnd: number;
  moved: boolean;
};

/**
 * Lịch dạng lưới: mỗi đánh giá viên một dòng, trục ngang là thời gian.
 *
 * Kéo giữa khối để dời giờ, kéo mép để đổi thời lượng, bước 5 phút. Vùng cấm
 * được CHẶN CỨNG chứ không cảnh báo sau: khối trượt tới sát mép giờ nghỉ trưa
 * hoặc sát phiên khác của cùng đánh giá viên rồi dừng lại ở đó. Nhờ vậy lịch
 * không bao giờ rơi vào trạng thái sai, và nút Lưu không phải đi kiểm tra lại.
 *
 * Dòng của một phiên KHÔNG kéo đổi được, vì dòng suy ra từ phân công ở bước
 * Chuẩn bị. Muốn đổi người thì sửa phân công, lưới tự đúng theo.
 */
export function ScheduleGrid({
  days, hoursOf, sessions, units, members, unitMembers, conflictIds, locked,
  draggingUnitId, defaultMinutes, onPatch, onRemove, onCreate, onSnapshot,
}: {
  days: string[];
  /** Khung giờ của từng ngày — mỗi ngày một trục thời gian riêng. */
  hoursOf: HoursOf;
  sessions: PlanSession[];
  units: Unit[];
  members: { id: string; fullName: string; short: string }[];
  unitMembers: Map<string, string[]>;
  conflictIds: Set<string>;
  locked: boolean;
  /** Đơn vị đang được nhấc lên từ kho — dùng để làm sáng dòng nó sắp rơi vào. */
  draggingUnitId: string | null;
  /** Thời lượng cho phiên mới thả từ kho xuống. */
  defaultMinutes: number;
  onPatch: (id: string, patch: Partial<PlanSession>) => void;
  onRemove: (id: string) => void;
  onCreate: (day: string, unitId: string, startTime: string, endTime: string) => void;
  /**
   * Đánh dấu mốc hoàn tác, gọi TRƯỚC khi đổi. `tag` để gộp một chuỗi thao tác
   * liên tiếp cùng loại thành một bước — cả lần kéo chuột, cả tràng phím mũi
   * tên đều chỉ đáng một lần Ctrl+Z.
   */
  onSnapshot: (tag?: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  /**
   * Bản sao ngoài React của trạng thái kéo. Mỗi lần chuột nhúc nhích là một lần
   * gọi onPatch, nên nếu đọc trạng thái qua state thì các sự kiện trong cùng một
   * khung hình sẽ đọc phải giá trị cũ.
   */
  const dragRef = useRef<Drag | null>(null);

  /**
   * Hình học của trục thời gian, tính riêng cho từng ngày.
   *
   * Mỗi ngày có khung giờ riêng nên trục cũng riêng: ngày vào lúc 09:00 thì
   * trục ngày đó bắt đầu từ 09:00. Mỗi bảng ngày do đó tự căn theo giờ của
   * chính nó, không dùng chung một thước.
   */
  function geometry(day: string) {
    const h = hoursOf(day);
    const start = toMinutes(h.amStart);
    const end = toMinutes(h.pmEnd);
    const span = Math.max(1, end - start);
    return {
      h,
      start,
      end,
      span,
      lunchStart: toMinutes(h.amEnd),
      lunchEnd: toMinutes(h.pmStart),
      pct: (m: number) => ((m - start) / span) * 100,
      width: (a: number, b: number) => ((b - a) / span) * 100,
      ticks: (() => {
        const out: number[] = [];
        for (let t = Math.ceil(start / 60) * 60; t <= end; t += 60) out.push(t);
        return out;
      })(),
    };
  }

  const colorOf = (unitId: string) =>
    UNIT_COLORS[Math.max(0, units.findIndex((u) => u.id === unitId)) % UNIT_COLORS.length];

  /* --- Dòng: mỗi đánh giá viên một dòng, cộng dòng "chưa phân công" nếu cần --- */
  const rows: Row[] = members.map((m) => ({ id: m.id, label: m.short, memberId: m.id }));

  const hasOrphan = sessions.some(
    (s) => s.kind === 'UNIT' && s.unitId && (unitMembers.get(s.unitId) ?? []).length === 0,
  );
  if (hasOrphan) rows.push({ id: 'orphan', label: 'Chưa phân công', memberId: null });

  /** Phiên nào thuộc dòng nào. */
  function sessionsForRow(day: string, row: Row) {
    return sessions.filter((s) => {
      if (s.day !== day) return false;
      if (s.kind !== 'UNIT') return true; // họp thì cả đoàn, hiện ở mọi dòng
      const ms = s.unitId ? unitMembers.get(s.unitId) ?? [] : [];
      return row.memberId ? ms.includes(row.memberId) : ms.length === 0;
    });
  }

  /** Khoảng trống hợp lệ cho một phiên, tính lại mỗi lần chuột nhúc nhích. */
  function freeFor(self: Pick<PlanSession, 'id' | 'day' | 'kind' | 'unitId'>): Span[] {
    const h = hoursOf(self.day);
    return freeSpans(blockedSpans({ self, sessions, hours: h, unitMembers }), h);
  }

  /* ---------------- Kéo thả ---------------- */

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>, s: PlanSession) {
    if (locked) return;
    const box = e.currentTarget.getBoundingClientRect();
    const lane = e.currentTarget.parentElement;
    if (!lane) return;

    const offset = e.clientX - box.left;
    const mode: Drag['mode'] =
      offset <= EDGE ? 'start' : offset >= box.width - EDGE ? 'end' : 'move';

    const next: Drag = {
      id: s.id,
      mode,
      pointerX: e.clientX,
      laneWidth: lane.getBoundingClientRect().width,
      origStart: toMinutes(s.startTime),
      origEnd: toMinutes(s.endTime),
      moved: false,
    };
    dragRef.current = next;
    setDrag(next);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>, s: PlanSession) {
    const d = dragRef.current;
    if (!d || d.id !== s.id) return;

    const dx = e.clientX - d.pointerX;
    if (!d.moved) {
      if (Math.abs(dx) < CLICK_SLOP) return;
      d.moved = true;
      // Ghi mốc ở đây chứ không ở lúc bấm chuột: bấm rồi thả tại chỗ là thao
      // tác chọn, không có gì để hoàn tác.
      onSnapshot();
      setDrag({ ...d });
    }

    const deltaMin = (dx / d.laneWidth) * geometry(s.day).span;
    const free = freeFor(s);

    if (d.mode === 'move') {
      const length = d.origEnd - d.origStart;
      const start = nearestStart(d.origStart + deltaMin, length, free);
      if (start === null) return;
      onPatch(s.id, { startTime: toHHMM(start), endTime: toHHMM(start + length) });
      return;
    }

    if (d.mode === 'end') {
      const limit = resizeLimit(d.origStart, 'end', free);
      if (!limit) return;
      const wanted = snapManual(d.origEnd + deltaMin);
      onPatch(s.id, { endTime: toHHMM(Math.min(Math.max(wanted, limit.start), limit.end)) });
      return;
    }

    const limit = resizeLimit(d.origEnd, 'start', free);
    if (!limit) return;
    const wanted = snapManual(d.origStart + deltaMin);
    onPatch(s.id, { startTime: toHHMM(Math.min(Math.max(wanted, limit.start), limit.end)) });
  }

  function handlePointerUp(s: PlanSession) {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    // Bấm mà không kéo thì mở khối sửa — giữ nguyên cách dùng cũ trên cảm ứng.
    if (d && !d.moved) setOpenId(openId === s.id ? null : s.id);
  }

  /* ---------------- Bàn phím ---------------- */

  /**
   * Bấm chọn một khối rồi dùng bàn phím: Delete/Backspace bỏ phiên, mũi tên
   * trái/phải dời 5 phút (giữ Shift thì 15 phút), Esc bỏ chọn.
   *
   * Nghe ở cấp window chứ không ở khối, vì khối rất dễ mất focus — bấm vào ô
   * giờ trong bảng sửa là focus đã đi chỗ khác trong khi khối vẫn đang chọn.
   * Đổi lại phải tự loại các ô nhập ra, nếu không thì xoá một chữ trong ô giờ
   * sẽ xoá luôn cả phiên.
   */
  useEffect(() => {
    if (locked || !openId) return;

    function onKeyDown(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el?.closest('input, select, textarea, [contenteditable]')) return;

      const s = sessions.find((x) => x.id === openId);
      if (!s) return;

      if (e.key === 'Escape') {
        setOpenId(null);
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        onRemove(s.id);
        setOpenId(null);
        return;
      }

      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();

      const step = (e.shiftKey ? STEP : MANUAL_STEP) * (e.key === 'ArrowLeft' ? -1 : 1);
      const a = toMinutes(s.startTime);
      const length = toMinutes(s.endTime) - a;
      const start = nearestStart(a + step, length, freeFor(s));
      if (start === null || start === a) return;

      onSnapshot(`nudge:${s.id}`);
      onPatch(s.id, { startTime: toHHMM(start), endTime: toHHMM(start + length) });
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  /* ---------------- Thả đơn vị từ kho xuống ---------------- */

  function handleDrop(e: React.DragEvent<HTMLDivElement>, day: string) {
    e.preventDefault();
    if (locked) return;

    const unitId = e.dataTransfer.getData('text/plain');
    if (!unitId || !units.some((u) => u.id === unitId)) return;

    const g = geometry(day);
    const box = e.currentTarget.getBoundingClientRect();
    const wanted = g.start + ((e.clientX - box.left) / box.width) * g.span;

    const self = { id: '__moi__', day, kind: 'UNIT' as const, unitId };
    const free = freeSpans(blockedSpans({ self, sessions, hours: g.h, unitMembers }), g.h);

    // Chỗ trống hẹp hơn thời lượng mặc định thì thu ngắn phiên lại, còn hơn im
    // lặng từ chối rồi để người dùng đoán xem vì sao thả không được.
    const widest = free.reduce((mx, f) => Math.max(mx, f.end - f.start), 0);
    const dur = Math.max(MIN_MANUAL, Math.min(defaultMinutes, widest));

    const start = nearestStart(wanted, dur, free);
    if (start === null) return;
    onCreate(day, unitId, toHHMM(start), toHHMM(start + dur));
  }

  if (rows.length === 0) {
    return (
      <p className="card p-6 text-sm text-slate-500">
        Chưa có đánh giá viên nào. Quay lại bước Chuẩn bị đợt để khai báo.
      </p>
    );
  }

  const dragged = drag?.moved ? sessions.find((s) => s.id === drag.id) ?? null : null;
  const draggedBlocked = dragged
    ? blockedSpans({ self: dragged, sessions, hours: hoursOf(dragged.day), unitMembers })
    : [];

  /** Dòng nào sẽ nhận đơn vị đang được nhấc lên từ kho. */
  const targetRows = new Set(draggingUnitId ? unitMembers.get(draggingUnitId) ?? [] : []);
  const targetOrphan =
    draggingUnitId !== null && (unitMembers.get(draggingUnitId) ?? []).length === 0;

  return (
    <div className="space-y-5">
      {days.map((day, dayIndex) => {
        const { h, span, lunchStart, lunchEnd, pct, width, ticks } = geometry(day);

        return (
        <div key={day} className="rounded-lg border border-slate-200">
          <p className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium">
            Ngày {dayIndex + 1} — {formatDayLong(day)}
            <span className="ml-2 font-normal text-slate-400">
              {h.amStart}–{h.amEnd} · {h.pmStart}–{h.pmEnd}
            </span>
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
              {rows.map((row) => {
                const isTarget = row.memberId ? targetRows.has(row.memberId) : targetOrphan;
                return (
                  <div key={row.id} className="flex border-b border-slate-100 last:border-0">
                    <div
                      className={`w-28 shrink-0 truncate px-3 py-2 text-xs font-medium ${
                        isTarget ? 'bg-brand-50 text-brand-700' : 'text-slate-700'
                      }`}
                      title={members.find((m) => m.id === row.id)?.fullName}
                    >
                      {row.label}
                    </div>

                    <div
                      onDragOver={(e) => {
                        if (!locked && draggingUnitId) e.preventDefault();
                      }}
                      onDrop={(e) => handleDrop(e, day)}
                      className={`relative h-12 flex-1 ${
                        isTarget ? 'bg-brand-50/60' : 'bg-slate-50/60'
                      }`}
                    >
                      {/* Dải nghỉ trưa */}
                      {lunchEnd > lunchStart && (
                        <div
                          className="absolute inset-y-0 bg-slate-200/70"
                          style={{
                            left: `${pct(lunchStart)}%`,
                            width: `${width(lunchStart, lunchEnd)}%`,
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

                      {/* Vùng cấm của khối đang kéo, hiện trên mọi dòng trong ngày */}
                      {dragged?.day === day &&
                        draggedBlocked.map((b) => (
                          <div
                            key={`${b.start}-${b.end}`}
                            className="pointer-events-none absolute inset-y-0 bg-red-500/10"
                            style={{ left: `${pct(b.start)}%`, width: `${width(b.start, b.end)}%` }}
                          />
                        ))}

                      {sessionsForRow(day, row).map((s) => {
                        const a = toMinutes(s.startTime);
                        const b = toMinutes(s.endTime);
                        const bad = conflictIds.has(s.id);
                        const unit = s.unitId ? units.find((u) => u.id === s.unitId) : null;
                        const active = drag?.id === s.id && drag.moved;

                        const cls =
                          s.kind !== 'UNIT'
                            ? 'bg-slate-800 text-white border-slate-900'
                            : s.unitId
                              ? colorOf(s.unitId)
                              : 'bg-slate-100 text-slate-600 border-slate-300';

                        return (
                          <div
                            key={s.id}
                            role="button"
                            tabIndex={0}
                            onPointerDown={(e) => handlePointerDown(e, s)}
                            onPointerMove={(e) => handlePointerMove(e, s)}
                            onPointerUp={() => handlePointerUp(s)}
                            onPointerCancel={() => {
                              dragRef.current = null;
                              setDrag(null);
                            }}
                            title={`${s.startTime}–${s.endTime} · ${
                              s.kind === 'UNIT' ? unit?.name ?? '—' : KIND_LABELS[s.kind]
                            }${locked ? '' : ' · kéo để dời giờ, kéo mép để đổi thời lượng'}`}
                            className={`absolute top-1 bottom-1 select-none overflow-hidden rounded border px-1.5 text-left text-[11px] leading-tight ${cls} ${
                              bad ? 'ring-2 ring-red-500' : ''
                            } ${openId === s.id ? 'ring-2 ring-brand-500' : ''} ${
                              active ? 'z-20 shadow-lg' : 'transition-[left,width]'
                            } ${locked ? '' : 'cursor-grab touch-none active:cursor-grabbing'}`}
                            style={{
                              left: `${pct(a)}%`,
                              width: `${Math.max(1.5, width(a, b))}%`,
                            }}
                          >
                            <span className="block truncate font-medium">
                              {s.kind === 'UNIT' ? unit?.name ?? '(đã xoá)' : KIND_LABELS[s.kind]}
                            </span>
                            <span className="block truncate opacity-70">
                              {s.startTime}–{s.endTime}
                            </span>

                            {!locked && (
                              <>
                                <span className="absolute inset-y-0 left-0 w-[7px] cursor-col-resize" />
                                <span className="absolute inset-y-0 right-0 w-[7px] cursor-col-resize" />
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* --- Khối sửa cho phiên đang chọn trong ngày này --- */}
          {openId && sessions.some((s) => s.id === openId && s.day === day) && !locked && (
            <SessionEditor
              session={sessions.find((s) => s.id === openId)!}
              units={units}
              days={days}
              onPatch={onPatch}
              onSnapshot={onSnapshot}
              onRemove={(id) => {
                onRemove(id);
                setOpenId(null);
              }}
              onClose={() => setOpenId(null)}
            />
          )}
        </div>
        );
      })}
    </div>
  );
}

function SessionEditor({
  session, units, days, onPatch, onSnapshot, onRemove, onClose,
}: {
  session: PlanSession;
  units: Unit[];
  days: string[];
  onPatch: (id: string, patch: Partial<PlanSession>) => void;
  onSnapshot: (tag?: string) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  /** Gõ vào ô giờ phát ra một sự kiện mỗi ký tự — gộp cả tràng thành một bước. */
  const patch = (field: string, value: Partial<PlanSession>) => {
    onSnapshot(`sua:${session.id}:${field}`);
    onPatch(session.id, value);
  };

  return (
    <div className="flex flex-wrap items-end gap-3 border-t border-slate-200 bg-brand-50/40 px-3 py-3 text-sm">
      <div>
        <span className="mb-1 block text-xs text-slate-500">Bắt đầu</span>
        <input
          type="time"
          step={300}
          value={session.startTime}
          onChange={(e) => patch('bat-dau', { startTime: e.target.value })}
          className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
        />
      </div>
      <div>
        <span className="mb-1 block text-xs text-slate-500">Kết thúc</span>
        <input
          type="time"
          step={300}
          value={session.endTime}
          onChange={(e) => patch('ket-thuc', { endTime: e.target.value })}
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
            onChange={(e) => patch('don-vi', { unitId: e.target.value })}
            className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          >
            {units.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>
      )}

      {days.length > 1 && (
        <div>
          <span className="mb-1 block text-xs text-slate-500">Ngày</span>
          <select
            value={session.day}
            onChange={(e) => patch('ngay', { day: e.target.value })}
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          >
            {days.map((d, i) => (
              <option key={d} value={d}>Ngày {i + 1}</option>
            ))}
          </select>
        </div>
      )}

      <span className="pb-2 text-xs text-slate-500">
        <kbd className="rounded border border-slate-300 bg-white px-1 font-mono">Delete</kbd> bỏ phiên
        {' · '}
        <kbd className="rounded border border-slate-300 bg-white px-1 font-mono">←</kbd>
        <kbd className="ml-0.5 rounded border border-slate-300 bg-white px-1 font-mono">→</kbd> dời 5
        phút
      </span>
      <button onClick={onClose} className="pb-2 text-xs text-slate-500 hover:underline">
        Đóng
      </button>
    </div>
  );
}
