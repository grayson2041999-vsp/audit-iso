import { Bar, CardListSkeleton } from '@/components/Skeletons';

export default function Loading() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Bar className="h-10 w-full rounded-lg" />
      <Bar className="h-3 w-36" />
      <div className="space-y-2">
        <Bar className="h-7 w-56" />
        <Bar className="h-3 w-48" />
      </div>
      <CardListSkeleton count={3} cols="" />
    </div>
  );
}
