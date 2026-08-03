import { Bar, Block } from '@/components/Skeletons';

export default function Loading() {
  return (
    <div className="space-y-6">
      <Bar className="h-3 w-40" />
      <Bar className="h-7 w-64" />
      <div className="card max-w-2xl space-y-5 p-6">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="space-y-2">
            <Bar className="h-3 w-32" />
            <Block className="h-10" />
          </div>
        ))}
      </div>
    </div>
  );
}
