/**
 * WHAT: Reusable table component that renders a list of Transaction rows.
 * WHY: Keeps the transactions page thin — layout and display logic stay here,
 *      data fetching stays in the page component.
 * BREAKS IF REMOVED: Transactions page has no way to display data.
 */

import type { Transaction } from "@/lib/api";
import CategoryBadge from "@/components/CategoryBadge";

interface TransactionTableProps {
  transactions: Transaction[];
}

function formatAmount(amount: string, type: string): string {
  const num = parseFloat(amount);
  const formatted = new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
  return type === "credit" ? `+${formatted}` : `-${formatted}`;
}

function formatDate(raw: string): string {
  // WHY: raw is ISO date string (YYYY-MM-DD) from the backend.
  // Append T00:00:00 to avoid UTC-to-local shift that would show the previous day.
  const d = new Date(`${raw}T00:00:00`);
  return d.toLocaleDateString("tr-TR", { day: "2-digit", month: "short", year: "numeric" });
}

export default function TransactionTable({ transactions }: TransactionTableProps) {
  if (transactions.length === 0) {
    return (
      <p className="text-center text-gray-500 py-16">
        Henüz işlem yok. Bir banka ekstresi yükleyin.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-800">
      <table className="w-full text-sm text-left">
        <thead className="bg-gray-900 text-gray-400 uppercase text-xs tracking-wide">
          <tr>
            <th className="px-4 py-3">Tarih</th>
            <th className="px-4 py-3">Açıklama</th>
            <th className="px-4 py-3 text-right">Tutar (₺)</th>
            <th className="px-4 py-3">Kategori</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800">
          {transactions.map((t) => (
            <tr
              key={t.id}
              className="bg-gray-950 hover:bg-gray-900 transition-colors"
            >
              <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                {formatDate(t.transaction_date)}
              </td>
              <td className="px-4 py-3 text-gray-200 max-w-xs truncate">
                {t.description}
              </td>
              <td
                className={`px-4 py-3 text-right font-mono whitespace-nowrap font-medium ${
                  t.transaction_type === "credit"
                    ? "text-emerald-400"
                    : "text-red-400"
                }`}
              >
                {formatAmount(t.amount, t.transaction_type)}
              </td>
              <td className="px-4 py-3">
                <CategoryBadge category={t.category} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
