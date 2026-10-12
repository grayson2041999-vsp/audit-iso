import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getLeader } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  // Trưởng đoàn đã đăng nhập thì vào thẳng khu quản lý.
  if (await getLeader()) redirect('/quan-ly');

  return (
    <div className="mx-auto max-w-5xl">
      {/* Hero Product Stage: nhãn nhỏ, câu tiêu đề lớn, mô tả gọn — căn giữa trên nền trống. */}
      <section className="py-10 text-center sm:py-16">
        <p className="font-display text-lg font-semibold text-ink sm:text-xl">
          ISO 9001 · ISO 14001 · ISO 45001
        </p>
        <h1 className="mx-auto mt-3 max-w-4xl font-display text-4xl font-semibold text-ink sm:text-5xl lg:text-6xl">
          Đánh giá nội bộ ISO
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-base text-slate-500">
          Quản lý đợt đánh giá và chuẩn hoá phát hiện theo ISO 9001:2015, ISO 14001:2015,
          ISO 45001:2018 với sự hỗ trợ của AI.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <Link href="/dang-nhap" className="btn-primary">Đăng nhập trưởng đoàn</Link>
          <Link href="/dang-ky" className="link text-base">Tạo tài khoản ›</Link>
        </div>
      </section>

      {/* Highlights Stage: hai thẻ trắng 28px trên nền Studio Mist. */}
      <section className="grid gap-5 sm:grid-cols-2">
        <div className="card flex flex-col p-8 sm:p-10">
          <h2 className="font-display text-2xl font-semibold">Tôi là trưởng đoàn</h2>
          <p className="mt-3 flex-1 text-base text-slate-500">
            Tạo đợt đánh giá, khai báo đơn vị và đánh giá viên, phân công, theo dõi bảng
            tổng hợp finding của toàn đợt.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link href="/dang-nhap" className="btn-primary">Đăng nhập</Link>
            <Link href="/dang-ky" className="link">Đăng ký ›</Link>
          </div>
        </div>

        <div className="card flex flex-col p-8 sm:p-10">
          <h2 className="font-display text-2xl font-semibold">Tôi là đánh giá viên</h2>
          <p className="mt-3 flex-1 text-base text-slate-500">
            Bạn không cần tài khoản. Mở đường link đợt đánh giá do trưởng đoàn gửi, bấm vào tên mình rồi nhập mã
            6 số được cấp.
          </p>
          <p className="mt-8 text-sm text-slate-500">
            Chưa có link? Liên hệ trưởng đoàn đánh giá của đợt.
          </p>
        </div>
      </section>

      <p className="mt-10 text-center text-xs text-slate-400">
        Bảng tổng hợp toàn đợt và xuất Excel sẽ có ở bản cập nhật tiếp theo.
      </p>
    </div>
  );
}
