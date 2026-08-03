import { Bar, Block } from '@/components/Skeletons';

export default function Loading() {
  return (
    <div className="space-y-6">
      <Bar className="h-10 w-full rounded-lg" />
      <Bar className="h-3 w-40" />
      <Bar className="h-7 w-80 max-w-full" />
      <div className="grid gap-6 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="card space-y-4 p-5">
            <Bar className="h-5 w-48" />
            <Bar className="h-3 w-full" />
            <Block className="h-40" />
            <Block className="h-24" />
          </div>
        ))}
      </div>
    </div>
  );
}
