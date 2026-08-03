import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getLeader } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  // Trưởng đoàn đã đăng nhập thì vào thẳng khu quản lý.
  if (await getLeader()) redirect('/quan-ly');

  return (
    <div className="mx-auto max-w-3xl space-y-8 py-8">
      <div className="text-center">
        <h1 className="text-3xl font-semibold">Đánh giá nội bộ ISO</h1>
        <p className="mx-auto mt-2 max-w-xl text-slate-600">
          Quản lý đợt đánh giá và chuẩn hoá phát hiện theo ISO 9001:2015, ISO 14001:2015,
          ISO 45001:2018 với sự hỗ trợ của AI.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="card flex flex-col p-6">
          <h2 className="font-semibold">Tôi là trưởng đoàn</h2>
          <p className="mt-1 flex-1 text-sm text-slate-500">
            Tạo đợt đánh giá, khai báo đơn vị và đánh giá viên, phân công, theo dõi bảng
            tổng hợp finding của toàn đợt.
          </p>
          <div className="mt-4 flex gap-2">
            <Link href="/dang-nhap" className="btn-primary flex-1">Đăng nhập</Link>
            <Link href="/dang-ky" className="btn-ghost">Đăng ký</Link>
          </div>
        </div>

        <div className="card flex flex-col p-6">
          <h2 className="font-semibold">Tôi là đánh giá viên</h2>
          <p className="mt-1 flex-1 text-sm text-slate-500">
            Bạn không cần tài khoản. Mở đường link đợt đánh giá do trưởng đoàn gửi, bấm
            vào tên mình rồi nhập mã 6 số được cấp.
          </p>
          <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-500">
            Chưa có link? Liên hệ trưởng đoàn đánh giá của đợt.
          </p>
        </div>
      </div>

      <p className="text-center text-xs text-slate-400">
        Đang phát triển từng phần — cổng đánh giá viên sẽ có ở bản cập nhật tiếp theo.{' '}
        <Link href="/findings" className="hover:underline">Xem finding đã lưu (bản cũ)</Link>
      </p>
    </div>
  );
}
