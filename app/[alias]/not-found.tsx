import Link from "next/link";

export default function AliasNotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#141832]">
      <div className="text-center px-6">
        <div className="text-6xl font-black text-white/10 mb-4">404</div>
        <h1 className="text-2xl font-bold text-white mb-2">
          Portfolio Not Found
        </h1>
        <p className="text-white/50 text-sm mb-6">
          No portfolio exists for this URL
        </p>
        <Link
          href="/"
          className="inline-block px-6 py-3 rounded-xl text-white text-sm font-semibold"
          style={{ backgroundColor: "#2A4792" }}
        >
          Go Home
        </Link>
      </div>
    </div>
  );
}
