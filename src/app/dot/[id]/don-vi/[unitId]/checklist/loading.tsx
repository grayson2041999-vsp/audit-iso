import { Bar, Block } from '@/components/Skeletons';

export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Bar className="h-10 w-full rounded-lg" />
      <Bar className="h-3 w-40" />
      <Bar className="h-7 w-64 max-w-full" />
      <div className="card space-y-4 p-5">
        <Bar className="h-5 w-72 max-w-full" />
        <Bar className="h-3 w-full" />
        <Block className="h-56" />
      </div>
    </div>
  );
}
