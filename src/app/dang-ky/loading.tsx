import { Bar, Block } from '@/components/Skeletons';

export default function Loading() {
  return (
    <div className="mx-auto max-w-md">
      <div className="card space-y-4 p-6">
        <Bar className="h-6 w-40" />
        <Bar className="h-3 w-full" />
        {[0, 1].map((i) => (
          <div key={i} className="space-y-2">
            <Bar className="h-3 w-20" />
            <Block className="h-10" />
          </div>
        ))}
        <Block className="h-10" />
      </div>
    </div>
  );
}
