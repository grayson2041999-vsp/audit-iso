'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

/** Thanh ngữ cảnh cho đánh giá viên: đang ở đợt nào, là ai, và lối thoát. */
export function MemberBar({
  auditId, auditTitle, memberName,
}: {
  auditId: string;
  auditTitle: string;
  memberName: string;
}) {
  const router = useRouter();

  async function leave() {
    await fetch(`/api/dot/${auditId}/thoat`, { method: 'POST' });
    router.push(`/dot/${auditId}`);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-slate-100 px-4 py-2.5 text-sm">
      <Link href={`/dot/${auditId}/toi`} className="font-medium hover:underline">
        {auditTitle}
      </Link>
      <span className="text-slate-400">·</span>
      <span className="text-slate-600">{memberName}</span>
      <button onClick={leave} className="ml-auto text-xs text-slate-500 hover:underline">
        Thoát
      </button>
    </div>
  );
}
