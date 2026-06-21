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

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform duration-200 ${open ? "rotate-180" : "rotate-0"}`}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export default function TransactionTable({ transactions, onCategoryCorrection }: TransactionTableProps) {
  const [rows, setRows] = useState<Record<string, RowState>>(() => {
    const init: Record<string, RowState> = {};
    for (const t of transactions) {
      init[t.id] = { category: t.category, notes: [], notesLoaded: false, expanded: false, saving: false, error: null };
    }
    return init;
  });

  if (transactions.length === 0) {
    return (
      <div className="text-center py-16 bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl">
        <p className="text-gray-500 text-sm">Henüz işlem yok.</p>
        <p className="text-gray-700 text-xs mt-1">Bir banka ekstresi yükleyin.</p>
      </div>
    );
  }

  const toggleExpand = async (id: string) => {
    const row = rows[id] ?? { expanded: false, notes: [], notesLoaded: false, category: null, saving: false, error: null };
    const nowExpanding = !row.expanded;
    setRows((prev) => ({ ...prev, [id]: { ...(prev[id] ?? row), expanded: nowExpanding } }));
    if (nowExpanding && !row.notesLoaded) {
      try {
        const notes = await getNotes(id);
        setRows((prev) => ({ ...prev, [id]: { ...prev[id], notes, notesLoaded: true } }));
      } catch {
        setRows((prev) => ({ ...prev, [id]: { ...prev[id], notesLoaded: true } }));
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
        [id]: { ...prev[id], saving: false, error: err instanceof Error ? err.message : "Kaydedilemedi" },
      }));
    }
  };

  const handleNoteAdded = (txId: string, note: NoteResponse) => {
    setRows((prev) => ({ ...prev, [txId]: { ...prev[txId], notes: [...prev[txId].notes, note] } }));
  };

  return (
    <div className="rounded-xl border border-[#2A2A2A] overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-[#1A1A1A] border-b border-[#2A2A2A]">
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide w-28">Tarih</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Açıklama</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wide w-36">Tutar</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide w-36">Kategori</th>
            <th className="px-4 py-3 w-8" />
          </tr>
        </thead>
        <tbody>
          {transactions.map((t, i) => {
            const row = rows[t.id] ?? {
              category: t.category, notes: [], notesLoaded: false, expanded: false, saving: false, error: null,
            };
            const isOdd = i % 2 !== 0;
            const rowBg = isOdd ? "bg-[#111]" : "bg-[#0F0F0F]";

            return (
              <Fragment key={t.id}>
                {/* Main row */}
                <tr
                  className={`${rowBg} hover:bg-[#1A1A1A] transition-colors duration-100 cursor-pointer group border-b border-[#2A2A2A] last:border-0`}
                  onClick={() => void toggleExpand(t.id)}
                >
                  {/* Date */}
                  <td className="px-4 py-3.5 whitespace-nowrap">
                    <span className="text-xs text-gray-500">{formatDate(t.transaction_date)}</span>
                  </td>

                  {/* Description */}
                  <td className="px-4 py-3.5 max-w-0">
                    <p
                      className="text-gray-200 text-sm truncate"
                      title={t.description}
                    >
                      {t.description}
                    </p>
                  </td>

                  {/* Amount */}
                  <td className="px-4 py-3.5 text-right whitespace-nowrap">
                    <span
                      className={`text-sm font-semibold tabular-nums ${
                        t.transaction_type === "credit" ? "text-emerald-400" : "text-red-400"
                      }`}
                    >
                      {formatAmount(t.amount, t.transaction_type)}
                    </span>
                  </td>

                  {/* Category badge */}
                  <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                    <CategoryBadge category={row.category} />
                  </td>

                  {/* Expand chevron */}
                  <td className="px-3 py-3.5">
                    <span className={`flex items-center justify-center transition-colors ${row.expanded ? "text-indigo-400" : "text-gray-600 group-hover:text-gray-400"}`}>
                      <ChevronIcon open={row.expanded} />
                    </span>
                  </td>
                </tr>

                {/* Expanded detail panel */}
                {row.expanded && (
                  <tr key={`${t.id}-detail`} className="bg-[#1A1A1A] border-b border-[#2A2A2A]">
                    <td colSpan={5} className="px-5 py-4">
                      {/* Panel header */}
                      <div className="flex items-start justify-between mb-4 pb-3 border-b border-[#2A2A2A]">
                        <div>
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-0.5">İşlem Detayı</p>
                          <p className="text-sm text-gray-300 leading-relaxed">{t.description}</p>
                        </div>
                        <div className="text-right shrink-0 ml-4">
                          <p className={`text-base font-bold tabular-nums ${t.transaction_type === "credit" ? "text-emerald-400" : "text-red-400"}`}>
                            {formatAmount(t.amount, t.transaction_type)} ₺
                          </p>
                          <p className="text-xs text-gray-600 mt-0.5">{formatDate(t.transaction_date)}</p>
                        </div>
                      </div>

                      {/* Category correction */}
                      <div className="mb-5">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                          Kategoriyi Düzelt
                          {row.saving && <span className="ml-2 text-indigo-400 normal-case font-normal">kaydediliyor…</span>}
                        </p>
                        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
                          {CATEGORIES.map((cat) => {
                            const isActive = row.category === cat;
                            return (
                              <button
                                key={cat}
                                disabled={row.saving}
                                onClick={() => void handleCategoryChange(t.id, cat)}
                                className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors disabled:opacity-40 ${
                                  isActive
                                    ? "bg-indigo-600 text-white"
                                    : "bg-[#2A2A2A] text-gray-400 hover:bg-[#333] hover:text-gray-200"
                                }`}
                              >
                                {CATEGORY_LABELS[cat] ?? cat}
                              </button>
                            );
                          })}
                        </div>
                        {row.error && <p className="text-xs text-red-400 mt-2">{row.error}</p>}
                      </div>

                      {/* Notes */}
                      <div>
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Notlar</p>
                        <NoteInput
                          transactionId={t.id}
                          existingNotes={row.notes}
                          onNoteAdded={(note) => handleNoteAdded(t.id, note)}
                        />
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
