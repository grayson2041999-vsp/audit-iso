'use client';

import { useMemo, useState } from 'react';
import {
  MIN_SESSION, durationLabel, roundsFor, solveDays, solveDuration, solveMembers, toHHMM,
  type SolveInput,
} from '@/lib/plan';

type Target = 'DURATION' | 'DAYS' | 'MEMBERS';

const TARGETS: { id: Target; label: string }[] = [
  { id: 'DURATION', label: 'Thời lượng mỗi đơn vị' },
  { id: 'DAYS', label: 'Số ngày cần' },
  { id: 'MEMBERS', label: 'Số đánh giá viên cần' },
];

/**
 * Máy tính ngược cho kế hoạch: khoá hai đại lượng, tính đại lượng thứ ba.
 *
 * Trưởng đoàn thường bị ràng buộc ngược — "sếp chỉ cho 2 ngày" hoặc "tôi chỉ
 * mượn được 4 người". Thay vì bắt họ mò xem số ngày đã chọn có đủ không, cho
 * họ hỏi thẳng và trả lời bằng con số.
 *
 * Đây là công cụ tham khảo, KHÔNG sửa dữ liệu của đợt.
 */
export function PlanCalculator({
  unitCount, actualDays, actualMembers, minutesPerDay, openingMinutes, closingMinutes,
  busiestRounds,
}: {
  unitCount: number;
  actualDays: number;
  actualMembers: number;
  minutesPerDay: number;
  openingMinutes: number;
  closingMinutes: number;
  /** Số vòng thực tế của người bận nhất theo phân công hiện tại. */
  busiestRounds: number;
}) {
  const [target, setTarget] = useState<Target>('DURATION');
  const [perSession, setPerSession] = useState(1);
  const [days, setDays] = useState(actualDays || 1);
  const [membersInput, setMembersInput] = useState(actualMembers || 1);
  const [wantedHours, setWantedHours] = useState(2);

  const input: SolveInput = useMemo(
    () => ({
      unitCount,
      auditorsPerSession: Math.max(1, perSession),
      minutesPerDay,
      openingMinutes,
      closingMinutes,
    }),
    [unitCount, perSession, minutesPerDay, openingMinutes, closingMinutes],
  );

  const wantedMinutes = Math.round(wantedHours * 60);

  const result = useMemo(() => {
    if (unitCount === 0) return null;

    if (target === 'DURATION') {
      const m = solveDuration(days, membersInput, input);
      return {
        value: m > 0 ? durationLabel('00:00', toHHMM(m)) : '—',
        note:
          m < MIN_SESSION
            ? `Dưới mức tối thiểu ${MIN_SESSION} phút — cần thêm ngày hoặc thêm người.`
            : `Người bận nhất phải làm ${roundsFor(membersInput, input)} lượt nối tiếp.`,
        bad: m < MIN_SESSION,
      };
    }

    if (target === 'DAYS') {
      const d = solveDays(wantedMinutes, membersInput, input);
      return {
        value: d > 0 ? `${d} ngày` : '—',
        note: `Với ${membersInput} đánh giá viên và mỗi đơn vị ${wantedHours} tiếng.`,
        bad: false,
      };
    }

    const m = solveMembers(wantedMinutes, days, input);
    return {
      value: m > 0 ? `${m} người` : 'Không đủ',
      note:
        m > 0
          ? m > actualMembers
            ? `Đang có ${actualMembers} người — cần thêm ${m - actualMembers} người nữa.`
            : `Đang có ${actualMembers} người, đã đủ.`
          : `Dù huy động tối đa cũng không đạt ${wantedHours} tiếng mỗi đơn vị trong ${days} ngày.`,
      bad: m === 0 || m > actualMembers,
    };
  }, [target, days, membersInput, wantedMinutes, wantedHours, input, unitCount, actualMembers]);

  if (unitCount === 0) return null;

  return (
    <section className="card space-y-4 p-5">
      <div>
        <h2 className="font-semibold">Máy tính kế hoạch</h2>
        <p className="mt-1 text-sm text-slate-500">
          Nhập hai đại lượng, hệ thống tính đại lượng còn lại. Không ảnh hưởng tới đợt đang lập.
        </p>
      </div>

      <div>
        <label className="label">Tôi muốn tính</label>
        <div className="flex flex-wrap gap-2">
          {TARGETS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTarget(t.id)}
              className={`rounded-lg border px-3 py-1.5 text-sm ${
                target === t.id
                  ? 'border-brand-600 bg-brand-50 font-medium text-brand-700'
                  : 'border-slate-300 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {target !== 'DAYS' && (
          <Num label="Số ngày" value={days} min={1} onChange={setDays} />
        )}
        {target !== 'MEMBERS' && (
          <Num label="Số đánh giá viên" value={membersInput} min={1} onChange={setMembersInput} />
        )}
        {target !== 'DURATION' && (
          <Num
            label="Mỗi đơn vị (tiếng)"
            value={wantedHours}
            min={0.5}
            step={0.5}
            onChange={setWantedHours}
          />
        )}
        <Num
          label="Người mỗi phiên"
          value={perSession}
          min={1}
          max={8}
          onChange={setPerSession}
        />
      </div>

      {result && (
        <div
          className={`rounded-lg px-4 py-3 ${
            result.bad ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-900'
          }`}
        >
          <p className="text-sm">
            {TARGETS.find((t) => t.id === target)!.label}:{' '}
            <strong className="text-lg">{result.value}</strong>
          </p>
          <p className="mt-0.5 text-xs">{result.note}</p>
        </div>
      )}

      <p className="border-t border-slate-100 pt-3 text-xs text-slate-500">
        Thực tế hiện tại: <strong>{unitCount} đơn vị</strong> · {actualDays} ngày ·{' '}
        {actualMembers} đánh giá viên
        {busiestRounds > 0 && ` · người bận nhất giữ ${busiestRounds} đơn vị`}
      </p>
    </section>
  );
}

function Num({
  label, value, onChange, min, max, step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        type="number"
        className="input"
        value={value}
        min={min}
        max={max}
        step={step ?? 1}
        onChange={(e) => onChange(Number(e.target.value) || min || 0)}
      />
    </div>
  );
}
