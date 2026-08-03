import { Bar, Block } from '@/components/Skeletons';

export default function Loading() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex flex-col items-center gap-2">
        <Bar className="h-3 w-24" />
        <Bar className="h-7 w-80 max-w-full" />
        <Bar className="h-3 w-64 max-w-full" />
      </div>
      <div className="card space-y-3 p-5">
        <Bar className="h-4 w-32" />
        <div className="grid gap-2 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Block key={i} className="h-12" />
          ))}
        </div>
      </div>
    </div>
  );
}
