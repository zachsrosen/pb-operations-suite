import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="text-center bg-surface rounded-xl p-8 border border-t-border shadow-card max-w-md">
        <div className="text-orange-500 text-6xl mb-4 font-bold">404</div>
        <h2 className="text-xl font-bold text-foreground mb-2">
          Page Not Found
        </h2>
        <p className="text-muted mb-6">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Link
          href="/"
          className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors inline-block"
        >
          Go Home
        </Link>
      </div>
    </div>
  );
}
