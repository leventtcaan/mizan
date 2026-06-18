"use client";

import { Fragment, useState } from "react";
import type { Transaction, NoteResponse } from "@/lib/api";
import { correctCategory, getNotes } from "@/lib/api";
import { CATEGORY_LABELS } from "@/lib/categories";
import CategoryBadge from "@/components/CategoryBadge";
import NoteInput from "@/components/NoteInput";

const CATEGORIES = [
  "market", "restoran", "ulasim", "eglence", "saglik",
  "fatura", "giyim", "nakit_atm", "transfer", "iade",
  "vergi", "teknoloji", "diger",
];

interface TransactionTableProps {
  transactions: Transaction[];
  onCategoryCorrection?: (txId: string, newCategory: string) => void;
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
  const d = new Date(`${raw}T00:00:00`);
  return d.toLocaleDateString("tr-TR", { day: "2-digit", month: "short", year: "numeric" });
}

interface RowState {
  category: string | null;
  notes: NoteResponse[];
  notesLoaded: boolean;
  expanded: boolean;
  saving: boolean;
  error: string | null;
}

export default function TransactionTable({ transactions, onCategoryCorrection }: TransactionTableProps) {
  const [rows, setRows] = useState<Record<string, RowState>>(() => {
    const init: Record<string, RowState> = {};
    for (const t of transactions) {
      init[t.id] = {
        category: t.category,
        notes: [],
        notesLoaded: false,
        expanded: false,
        saving: false,
        error: null,
      };
    }
    return init;
  });

  if (transactions.length === 0) {
    return (
      <p className="text-center text-gray-500 py-16">
        Henüz işlem yok. Bir banka ekstresi yükleyin.
      </p>
    );
  }

  const toggleExpand = async (id: string) => {
    const row = rows[id];
    const nowExpanding = !row.expanded;

    setRows((prev) => ({
      ...prev,
      [id]: { ...prev[id], expanded: nowExpanding },
    }));

    // Fetch notes from DB on first expand only
    if (nowExpanding && !row.notesLoaded) {
      try {
        const notes = await getNotes(id);
        setRows((prev) => ({
          ...prev,
          [id]: { ...prev[id], notes, notesLoaded: true },
        }));
      } catch {
        // Silent — notes panel still renders, just empty
        setRows((prev) => ({
          ...prev,
          [id]: { ...prev[id], notesLoaded: true },
        }));
      }
    }
  };

  const handleCategoryChange = async (id: string, newCat: string) => {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], saving: true, error: null } }));
    try {
      await correctCategory(id, newCat);
      setRows((prev) => ({ ...prev, [id]: { ...prev[id], category: newCat, saving: false } }));
      onCategoryCorrection?.(id, newCat);
    } catch (err) {
      setRows((prev) => ({
        ...prev,
        [id]: {
          ...prev[id],
          saving: false,
          error: err instanceof Error ? err.message : "Kaydedilemedi",
        },
      }));
    }
  };

  const handleNoteAdded = (txId: string, note: NoteResponse) => {
    setRows((prev) => ({
      ...prev,
      [txId]: { ...prev[txId], notes: [...prev[txId].notes, note] },
    }));
  };

  return (
    <div className="rounded-lg border border-gray-800 overflow-hidden">
      <table className="w-full text-sm text-left">
        <thead className="bg-gray-900 text-gray-400 uppercase text-xs tracking-wide">
          <tr>
            <th className="px-4 py-3">Tarih</th>
            <th className="px-4 py-3">Açıklama</th>
            <th className="px-4 py-3 text-right">Tutar (₺)</th>
            <th className="px-4 py-3">Kategori</th>
            <th className="px-4 py-3 w-8"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800">
          {transactions.map((t) => {
            const row = rows[t.id] ?? {
              category: t.category,
              notes: [],
              notesLoaded: false,
              expanded: false,
              saving: false,
              error: null,
            };
            return (
              <Fragment key={t.id}>
                <tr
                  className="bg-gray-950 hover:bg-gray-900 transition-colors cursor-pointer"
                  onClick={() => void toggleExpand(t.id)}
                >
                  <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                    {formatDate(t.transaction_date)}
                  </td>
                  <td className="px-4 py-3 text-gray-200 max-w-xs truncate">
                    {t.description}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-mono whitespace-nowrap font-medium ${
                      t.transaction_type === "credit" ? "text-emerald-400" : "text-red-400"
                    }`}
                  >
                    {formatAmount(t.amount, t.transaction_type)}
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <CategoryBadge category={row.category} />
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-xs select-none">
                    {row.expanded ? "▲" : "▼"}
                  </td>
                </tr>
                {row.expanded && (
                  <tr key={`${t.id}-detail`} className="bg-gray-900">
                    <td colSpan={5} className="px-4 py-3">
                      <div className="space-y-3">
                        <div>
                          <label className="text-xs text-gray-500 uppercase tracking-wide block mb-1">
                            Kategoriyi Düzelt
                          </label>
                          <div className="flex flex-wrap gap-1">
                            {CATEGORIES.map((cat) => (
                              <button
                                key={cat}
                                disabled={row.saving}
                                onClick={() => void handleCategoryChange(t.id, cat)}
                                className={`px-2 py-0.5 rounded text-xs transition-colors ${
                                  row.category === cat
                                    ? "bg-indigo-600 text-white"
                                    : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                                } disabled:opacity-40`}
                              >
                                {CATEGORY_LABELS[cat] ?? cat}
                              </button>
                            ))}
                          </div>
                          {row.error && (
                            <p className="text-xs text-red-400 mt-1">{row.error}</p>
                          )}
                        </div>
                        <div>
                          <label className="text-xs text-gray-500 uppercase tracking-wide block mb-1">
                            Notlar
                          </label>
                          <NoteInput
                            transactionId={t.id}
                            existingNotes={row.notes}
                            onNoteAdded={(note) => handleNoteAdded(t.id, note)}
                          />
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
