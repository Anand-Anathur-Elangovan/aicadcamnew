import Link from "next/link";
import { ShopHeader } from "@/components/shop/ShopHeader";
import { listRouters, quantityAddsUp } from "@/lib/shop/routers";

export const dynamic = "force-dynamic";
export const metadata = { title: "Routers | Manufacturing Intelligence" };

const STATUSES = ["", "Released", "Running", "Inspection", "Finished", "Shipped"];

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function RoutersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; status?: string | string[] }>;
}) {
  const params = await searchParams;
  const query = one(params.q);
  const status = one(params.status);
  const routers = await listRouters(query, status);

  return (
    <div className="min-h-screen bg-gray-50">
      <ShopHeader title="Released jobs" />
      <main className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        <p className="text-sm text-gray-600">
          Each router is one released batch. The counts are the same job balance Ask AI reads.
        </p>
        <form className="flex flex-wrap gap-2" action="/routers">
          <input
            name="q"
            defaultValue={query}
            placeholder="Router, part number, or name"
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 w-64"
          />
          <select
            name="status"
            defaultValue={STATUSES.includes(status) ? status : ""}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900"
          >
            <option value="">All statuses</option>
            {STATUSES.filter(Boolean).map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          <button type="submit" className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white">
            Filter
          </button>
        </form>
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2">Router</th>
                <th className="px-3 py-2">Part</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Order</th>
                <th className="px-3 py-2 text-right">Running</th>
                <th className="px-3 py-2 text-right">Waiting</th>
                <th className="px-3 py-2 text-right">Scrap</th>
                <th className="px-3 py-2 text-right">Finished</th>
                <th className="px-3 py-2 text-right">Shipped</th>
                <th className="px-3 py-2">Due</th>
                <th className="px-3 py-2">Where now</th>
              </tr>
            </thead>
            <tbody>
              {routers.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-3 py-6 text-center text-gray-500">No routers match this filter.</td>
                </tr>
              ) : routers.map((router) => (
                <tr key={router.routerNo} className="border-t border-gray-100">
                  <td className="px-3 py-2 font-medium">
                    <Link href={`/routers/${router.routerNo}`} className="text-blue-700 hover:underline">
                      {router.routerNo}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{router.partNumber} {router.partName}</td>
                  <td className="px-3 py-2">{router.status}</td>
                  <td className="px-3 py-2 text-right">{router.orderQty}</td>
                  <td className="px-3 py-2 text-right">{router.qtyRunning}</td>
                  <td className="px-3 py-2 text-right">{router.qtyWaiting}</td>
                  <td className="px-3 py-2 text-right">{router.qtyScrap}</td>
                  <td className="px-3 py-2 text-right">{router.qtyFinished}</td>
                  <td className="px-3 py-2 text-right">{router.qtyShipped}</td>
                  <td className="px-3 py-2">
                    {router.dueOn}
                    {quantityAddsUp(router) ? "" : " · balance mismatch"}
                  </td>
                  <td className="px-3 py-2">{router.whereNow}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-500">{routers.length} shown. Order quantity is running + waiting + scrap + finished + shipped.</p>
      </main>
    </div>
  );
}
