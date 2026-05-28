"use client";

/** Full-dashboard skeleton shown while analysis is running */
export function SkeletonDashboard({ includesENS }: { includesENS: boolean }) {
  return (
    <div className="space-y-4 animate-fade-in-up">
      {/* Top row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Identity skeleton */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
          <div className="skeleton h-3 w-20 mb-5" />
          <div className="flex items-center gap-4">
            <div className="skeleton w-14 h-14 rounded-full flex-shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="skeleton h-4 w-32" />
              <div className="skeleton h-3 w-24" />
            </div>
          </div>
          {includesENS && (
            <div className="mt-4 space-y-2">
              <div className="skeleton h-3 w-40" />
              <div className="skeleton h-3 w-36" />
            </div>
          )}
        </div>

        {/* Score skeleton */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
          <div className="skeleton h-3 w-24 mb-5" />
          <div className="flex items-center justify-between mb-6">
            <div className="space-y-2">
              <div className="skeleton h-12 w-20" />
              <div className="skeleton h-4 w-28" />
            </div>
            <div className="skeleton w-20 h-20 rounded-full" />
          </div>
          <div className="space-y-4">
            {[80, 60, 40, 30].map((w, i) => (
              <div key={i} className="space-y-1.5">
                <div className="flex justify-between">
                  <div className="skeleton h-3" style={{ width: `${w}%` }} />
                  <div className="skeleton h-3 w-6" />
                </div>
                <div className="skeleton h-1.5 w-full rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Contract list skeleton */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="skeleton h-3 w-36" />
          <div className="skeleton h-5 w-12 rounded-full" />
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center justify-between p-3 bg-slate-800/40 rounded-xl">
              <div className="flex items-center gap-3">
                <div className="skeleton w-8 h-8 rounded-lg flex-shrink-0" />
                <div className="space-y-1.5">
                  <div className="skeleton h-3 w-28" />
                  <div className="skeleton h-2.5 w-20" />
                </div>
              </div>
              <div className="skeleton h-3 w-16" />
            </div>
          ))}
        </div>
      </div>

      {/* Mint skeleton */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
        <div className="flex items-start gap-4 mb-5">
          <div className="skeleton w-14 h-14 rounded-xl flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-4 w-48" />
            <div className="skeleton h-3 w-64" />
          </div>
        </div>
        <div className="flex gap-3">
          <div className="skeleton flex-1 h-10 rounded-xl" />
          <div className="skeleton flex-1 h-10 rounded-xl" />
        </div>
      </div>
    </div>
  );
}
