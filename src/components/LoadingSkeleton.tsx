"use client";

/**
 * Unified Loading Skeleton Components
 *
 * Use these components instead of spinners for better perceived performance.
 * Skeletons show the shape of content that's loading, reducing cognitive load.
 */

// Basic shimmer animation
const shimmerClass = "animate-pulse bg-surface-2";

export function SkeletonText({ width = "w-24", className = "" }: { width?: string; className?: string }) {
  return <div className={`h-4 ${shimmerClass} rounded ${width} ${className}`} />;
}

export function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <div className={`bg-surface border border-t-border rounded-xl p-4 shadow-card ${className}`}>
      <div className="flex justify-between items-start mb-3">
        <SkeletonText width="w-32" />
        <SkeletonText width="w-16" />
      </div>
      <SkeletonText width="w-48" className="mb-2" />
      <SkeletonText width="w-24" />
    </div>
  );
}

export function SkeletonStatCard() {
  return (
    <div className="bg-surface border border-t-border rounded-xl p-4 shadow-card">
      <div className={`h-8 ${shimmerClass} rounded w-20 mb-2`} />
      <SkeletonText width="w-24" />
    </div>
  );
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="bg-surface border border-t-border rounded-xl overflow-hidden shadow-card">
      {/* Header */}
      <div className="grid grid-cols-6 gap-4 px-4 py-3 bg-background border-b border-t-border">
        {[...Array(6)].map((_, i) => (
          <SkeletonText key={i} width="w-16" />
        ))}
      </div>
      {/* Rows */}
      {[...Array(rows)].map((_, rowIdx) => (
        <div key={rowIdx} className="grid grid-cols-6 gap-4 px-4 py-3 border-b border-t-border">
          {[...Array(6)].map((_, colIdx) => (
            <SkeletonText key={colIdx} width={colIdx === 0 ? "w-32" : "w-20"} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonCalendar() {
  return (
    <div className="bg-surface border border-t-border rounded-xl p-4 shadow-card">
      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <SkeletonText width="w-32" />
        <div className="flex gap-2">
          <div className={`h-8 w-8 ${shimmerClass} rounded`} />
          <div className={`h-8 w-8 ${shimmerClass} rounded`} />
        </div>
      </div>
      {/* Day headers */}
      <div className="grid grid-cols-7 gap-2 mb-2">
        {[...Array(7)].map((_, i) => (
          <SkeletonText key={i} width="w-full" className="h-6" />
        ))}
      </div>
      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-2">
        {[...Array(35)].map((_, i) => (
          <div key={i} className={`h-24 ${shimmerClass} rounded-lg`} />
        ))}
      </div>
    </div>
  );
}

export function SkeletonProjectQueue({ items = 5 }: { items?: number }) {
  return (
    <div className="space-y-2">
      {[...Array(items)].map((_, i) => (
        <div key={i} className="bg-surface border border-t-border rounded-lg p-3 shadow-card">
          <div className="flex justify-between items-start mb-2">
            <SkeletonText width="w-40" />
            <SkeletonText width="w-16" />
          </div>
          <div className="flex gap-2">
            <SkeletonText width="w-20" />
            <SkeletonText width="w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonDashboard() {
  return (
    <div className="space-y-6">
      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <SkeletonStatCard key={i} />
        ))}
      </div>
      {/* Main content */}
      <SkeletonTable rows={8} />
    </div>
  );
}

export function SkeletonScheduler() {
  return (
    <div className="flex gap-4 h-[calc(100vh-200px)]">
      {/* Left sidebar - project queue */}
      <div className="w-80 flex-shrink-0">
        <div className={`h-10 ${shimmerClass} rounded-lg mb-4`} />
        <SkeletonProjectQueue items={6} />
      </div>
      {/* Main calendar */}
      <div className="flex-1">
        <SkeletonCalendar />
      </div>
    </div>
  );
}

// Full page loading state
export function LoadingPage({ message = "Loading..." }: { message?: string }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-orange-500 mx-auto mb-4" />
        <p className="text-muted">{message}</p>
      </div>
    </div>
  );
}
