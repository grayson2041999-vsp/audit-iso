import { DetailSkeleton, PageHeadSkeleton } from '@/components/Skeletons';

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeadSkeleton />
      <DetailSkeleton />
    </div>
  );
}
