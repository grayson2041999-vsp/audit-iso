import { Bar, DetailSkeleton } from '@/components/Skeletons';

export default function Loading() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Bar className="h-10 w-full rounded-lg" />
      <Bar className="h-3 w-36" />
      <div className="space-y-2">
        <Bar className="h-4 w-48" />
        <Bar className="h-7 w-96 max-w-full" />
        <Bar className="h-3 w-64 max-w-full" />
      </div>
      <DetailSkeleton />
    </div>
  );
}
