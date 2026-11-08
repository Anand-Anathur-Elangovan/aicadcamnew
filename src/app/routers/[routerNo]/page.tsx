import { notFound } from "next/navigation";
import { ShopHeader } from "@/components/shop/ShopHeader";
import { getRouter, quantityAddsUp } from "@/lib/shop/routers";

export const dynamic = "force-dynamic";

function hours(minutes: number | null): string {
  if (minutes == null) return "—";
  return (minutes / 60).toFixed(2);
}

function when(value: string | null): string {
  if (!value) return "open";
  return value.replace("T", " ").slice(0, 16) + " UTC";
}

export async function generateMetadata({ params }: { params: Promise<{ routerNo: string }> }) {
  const { routerNo } = await params;
  return { title: `${routerNo} | Routers` };
}

export default async function RouterPage({ params }: { params: Promise<{ routerNo: string }> }) {
  const { routerNo } = await params;
  const router = await getRouter(decodeURIComponent(routerNo));
  if (!router) notFound();
  const balanced = quantityAddsUp(router);

  return (
    <div className="min-h-screen bg-gray-50">
      <ShopHeader title={router.routerNo} />
      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h2 className="text-lg font-semibold text-gray-900">{router.partNumber} {router.partName}</h2>
            <span className="text-sm text-gray-500">{router.revision} · {router.material}</span>
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-800">{router.status}</span>
          </div>
          <dl className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div><dt className="text-gray-500">Order</dt><dd>{router.orderQty}</dd></div>
            <div><dt className="text-gray-500">Issued</dt><dd>{router.qtyIssued}</dd></div>
            <div><dt className="text-gray-500">Heat / lot</dt><dd>{router.heatLot}</dd></div>
            <div><dt className="text-gray-500">Sales order</dt><dd>{router.salesOrder}</dd></div>
            <div><dt className="text-gray-500">Released</dt><dd>{router.releasedOn}</dd></div>
            <div><dt className="text-gray-500">Due</dt><dd>{router.dueOn}</dd></div>
            <div><dt className="text-gray-500">Rework loops</dt><dd>{router.qtyReworkLoops}</dd></div>
            <div><dt className="text-gray-500">Shipped on</dt><dd>{router.shippedOn ?? "—"}</dd></div>
          </dl>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-gray-900">Quantity balance</h3>
          <p className="mt-2 text-sm text-gray-700">
            {router.orderQty} ordered = {router.qtyRunning} running + {router.qtyWaiting} waiting + {router.qtyScrap} scrap + {router.qtyFinished} finished + {router.qtyShipped} shipped.
          </p>
          <p className={`mt-1 text-sm ${balanced ? "text-green-700" : "text-red-700"}`}>
            {balanced ? "The buckets add up to the order quantity." : "The buckets do not add up to the order quantity."}
          </p>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-gray-900">Where the pieces are</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {router.stages.filter((stage) => stage.isCurrent).map((stage) => (
              <li key={`now-${stage.stageName}`}>
                {stage.qty} at {stage.stageName}
                {stage.opNo != null ? ` (op ${stage.opNo})` : ""}
                {stage.vendorName ? ` · ${stage.vendorName}` : ""}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-gray-500">
            Already passed: {router.stages.filter((stage) => !stage.isCurrent).map((stage) => `${stage.stageName} ${stage.qty}`).join(", ") || "none"}.
          </p>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-900">Operations</h3>
          {router.operations.map((op) => (
            <div key={op.opNo} className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex flex-wrap gap-x-4 text-sm">
                <span className="font-medium text-gray-900">Op {op.opNo} {op.opName}</span>
                <span className="text-gray-500">{op.workCenter}</span>
                <span className="text-gray-500">{op.status}</span>
                <span className="text-gray-500">Standard {hours(op.standardMinutes)} h</span>
              </div>
              {op.moves.length === 0 ? (
                <p className="mt-2 text-sm text-gray-500">No move booked.</p>
              ) : (
                <table className="mt-3 min-w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="py-1 pr-3">Machine</th>
                      <th className="py-1 pr-3">Operator</th>
                      <th className="py-1 pr-3">Started</th>
                      <th className="py-1 pr-3">Finished</th>
                      <th className="py-1 pr-3 text-right">Hours</th>
                      <th className="py-1 pr-3 text-right">Good</th>
                      <th className="py-1 pr-3 text-right">Scrap</th>
                      <th className="py-1 pr-3 text-right">Rework</th>
                    </tr>
                  </thead>
                  <tbody>
                    {op.moves.map((move, index) => (
                      <tr key={`${op.opNo}-${index}`} className="border-t border-gray-100">
                        <td className="py-1 pr-3">{move.machineName}</td>
                        <td className="py-1 pr-3">{move.operatorName}</td>
                        <td className="py-1 pr-3">{when(move.startedAt)}</td>
                        <td className="py-1 pr-3">{move.isRunning ? "running" : when(move.finishedAt)}</td>
                        <td className="py-1 pr-3 text-right">{hours(move.actualMinutes)}</td>
                        <td className="py-1 pr-3 text-right">{move.qtyGood}</td>
                        <td className="py-1 pr-3 text-right">{move.qtyScrap}</td>
                        <td className="py-1 pr-3 text-right">{move.qtyRework}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-gray-900">Quality</h3>
          {router.quality.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">No inspection or reject booked.</p>
          ) : (
            <ul className="mt-2 space-y-2 text-sm">
              {router.quality.map((event, index) => (
                <li key={index}>
                  <span className="font-medium">{event.result}</span>
                  {event.opNo != null ? ` · op ${event.opNo} ${event.opName ?? ""}` : ""}
                  {event.reason ? ` · ${event.reason}` : ""}
                  {` · ${event.inspectorName}`}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-gray-900">Shipments</h3>
          {router.shipments.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">Nothing shipped against this router.</p>
          ) : (
            <ul className="mt-2 space-y-2 text-sm">
              {router.shipments.map((shipment) => (
                <li key={shipment.packingList}>
                  {shipment.shippedOn} · {shipment.qtyShipped} pieces · {shipment.packingList} · {shipment.salesOrder}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
