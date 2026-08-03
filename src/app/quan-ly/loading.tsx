import { PageHeadSkeleton, CardListSkeleton } from '@/components/Skeletons';

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeadSkeleton />
      <CardListSkeleton count={4} />
    </div>
  );
}
