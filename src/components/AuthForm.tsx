'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export function AuthForm({ mode }: { mode: 'dang-ky' | 'dang-nhap' }) {
  const router = useRouter();
  const isSignup = mode === 'dang-ky';

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isSignup ? { fullName, email, password } : { email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Không thực hiện được.');
      router.push('/quan-ly');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lỗi không xác định.');
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <div className="card p-6">
        <h1 className="text-xl font-semibold">
          {isSignup ? 'Đăng ký trưởng đoàn đánh giá' : 'Đăng nhập'}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {isSignup
            ? 'Tài khoản dùng để tạo và quản lý các đợt đánh giá nội bộ.'
            : 'Dành cho trưởng đoàn. Đánh giá viên vào bằng đường link đợt và mã 6 số.'}
        </p>

        <form onSubmit={submit} className="mt-5 space-y-4">
          {isSignup && (
            <div>
              <label className="label">Họ và tên</label>
              <input
                className="input"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Nguyễn Văn A"
                autoComplete="name"
                required
              />
            </div>
          )}

          <div>
            <label className="label">Email</label>
            <input
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ten@congty.com"
              autoComplete="email"
              required
            />
          </div>

          <div>
            <label className="label">Mật khẩu</label>
            <input
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              required
            />
            {isSignup && <p className="mt-1 text-xs text-slate-400">Tối thiểu 8 ký tự.</p>}
          </div>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <button type="submit" disabled={busy} className="btn-primary w-full">
            {busy ? 'Đang xử lý…' : isSignup ? 'Tạo tài khoản' : 'Đăng nhập'}
          </button>
        </form>
      </div>

      <p className="mt-4 text-center text-sm text-slate-500">
        {isSignup ? (
          <>
            Đã có tài khoản?{' '}
            <Link href="/dang-nhap" className="text-brand-600 hover:underline">Đăng nhập</Link>
          </>
        ) : (
          <>
            Chưa có tài khoản?{' '}
            <Link href="/dang-ky" className="text-brand-600 hover:underline">Đăng ký</Link>
          </>
        )}
      </p>
    </div>
  );
}
