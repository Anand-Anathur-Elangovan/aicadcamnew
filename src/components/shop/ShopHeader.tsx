import Link from "next/link";

export function ShopHeader({ title }: { title: string }) {
  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
        <Link href="/" className="text-xs text-gray-500 hover:text-gray-900">Home</Link>
        <span className="text-gray-300">/</span>
        <Link href="/routers" className="text-xs text-gray-500 hover:text-gray-900">Routers</Link>
        <span className="text-gray-300">/</span>
        <h1 className="text-sm font-semibold text-gray-900">{title}</h1>
        <div className="flex-1" />
        <Link
          href="/chat"
          className="text-xs font-medium text-blue-700 hover:text-blue-900"
        >
          Ask AI
        </Link>
      </div>
    </header>
  );
}
