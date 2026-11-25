export function TableSkeleton({ rows = 5, columns = 6 }: { rows?: number; columns?: number }) {
  return (
    <div className="divide-y divide-slate-200 bg-white">
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <div key={rowIdx} className="grid grid-cols-6 gap-4 px-6 py-4">
          {Array.from({ length: columns }).map((__, colIdx) => (
            <div
              key={colIdx}
              className="h-4 animate-pulse rounded bg-slate-200"
              style={{ width: colIdx === 0 ? '90%' : '70%' }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
