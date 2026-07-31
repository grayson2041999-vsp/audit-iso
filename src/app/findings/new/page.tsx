import { FindingWorkbench } from '@/components/FindingWorkbench';

export const metadata = { title: 'Ghi nhận finding mới' };

export default function NewFindingPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Ghi nhận & chuẩn hoá finding</h1>
        <p className="mt-1 text-sm text-slate-500">
          Nhập ghi nhận thô tại hiện trường, đính kèm ảnh (tuỳ chọn) — AI chuẩn hoá theo cấu trúc
          Yêu cầu – Sự không phù hợp – Bằng chứng khách quan.
        </p>
      </div>
      <FindingWorkbench />
    </div>
  );
}
