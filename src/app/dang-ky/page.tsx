import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/AuthForm';
import { getLeader } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Đăng ký trưởng đoàn' };

export default async function Page() {
  if (await getLeader()) redirect('/quan-ly');
  return <AuthForm mode="dang-ky" />;
}
