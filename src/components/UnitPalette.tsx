'use client';

import { durationLabel, toHHMM } from '@/lib/plan';

type Unit = { id: string; name: string };

/** Cùng bảng màu với ScheduleGrid — tên trong kho và khối trong lịch phải trùng màu. */
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
 * Kho đơn vị: kéo tên đơn vị xuống một ngày trong lưới để tạo phiên.
 *
 * Một đơn vị thả được nhiều lần — sáng một phiên, chiều một phiên, thậm chí
 * khác ngày. Vì vậy mỗi tên đều hiện "đã xếp bao nhiêu / cần bao nhiêu": con
 * số này là thứ duy nhất cho biết đơn vị đã đủ giờ hay chưa, khi mà một đơn vị
 * không còn tương ứng một khối.
 */
export function UnitPalette({
  units, targetMinutes, allocated, unitMembers, shortById, locked,
  onDragStart, onDragEnd,
}: {
  units: Unit[];
  /** Thời lượng nên dành cho mỗi đơn vị, phút. */
  targetMinutes: number;
  /** Số phút đã xếp trong lịch cho từng đơn vị. */
  allocated: Map<string, number>;
  unitMembers: Map<string, string[]>;
  shortById: Map<string, string>;
  locked: boolean;
  onDragStart: (unitId: string) => void;
  onDragEnd: () => void;
}) {
  if (units.length === 0) return null;

  return (
    <section className="card p-5">
      <div className="mb-3">
        <h2 className="font-semibold">Kho đơn vị</h2>
        <p className="mt-1 text-sm text-slate-500">
          {locked
            ? 'Đợt đã khoá, không sửa lịch được nữa.'
            : 'Kéo tên đơn vị thả xuống một ngày trong lưới bên dưới để tạo phiên. Thả được nhiều lần nếu muốn tách buổi sáng và buổi chiều.'}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {units.map((u, i) => {
          const done = allocated.get(u.id) ?? 0;
          const people = (unitMembers.get(u.id) ?? [])
            .map((m) => shortById.get(m))
            .filter(Boolean)
            .join(', ');

          const state =
            done === 0 ? 'chua' : done < targetMinutes ? 'thieu' : done > targetMinutes ? 'du' : 'dung';

          return (
            <div
              key={u.id}
              draggable={!locked}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', u.id);
                e.dataTransfer.effectAllowed = 'copy';
                onDragStart(u.id);
              }}
              onDragEnd={onDragEnd}
              title={people ? `Đánh giá viên: ${people}` : 'Chưa phân công đánh giá viên nào'}
              className={`rounded-lg border px-3 py-2 text-sm ${UNIT_COLORS[i % UNIT_COLORS.length]} ${
                locked ? '' : 'cursor-grab active:cursor-grabbing'
              } ${state === 'chua' ? 'opacity-60' : ''}`}
            >
              <span className="block font-medium">{u.name}</span>
              <span className="block text-[11px] opacity-80">
                {done === 0
                  ? 'chưa xếp'
                  : `${durationLabel('00:00', toHHMM(done))} / ${durationLabel('00:00', toHHMM(targetMinutes))}`}
                {state === 'thieu' && ' · còn thiếu'}
                {state === 'du' && ' · vượt mức'}
              </span>
              <span className="block text-[11px] opacity-70">
                {people || 'chưa có đánh giá viên'}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
