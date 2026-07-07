"use client";

import { Fragment, useState } from "react";
import type { Transaction, NoteResponse } from "@/lib/api";
import { correctCategory, getNotes, deleteTransaction } from "@/lib/api";
import { Pencil, X } from "@/components/ui/Icons";
import CategoryBadge from "@/components/CategoryBadge";
import NoteInput from "@/components/NoteInput";
import { useLanguage } from "@/lib/i18n";

const CATEGORIES = [
  "market", "restoran", "ulasim", "eglence", "saglik",
  "fatura", "giyim", "nakit_atm", "transfer", "iade",
  "vergi", "teknoloji", "diger",
];

interface TransactionTableProps {
  transactions: Transaction[];
  onCategoryCorrection?: (txId: string, newCategory: string) => void;
  // Editing opens the shared transaction modal (owned by the page); deletion is
  // handled here (confirm + API) and reported up so the list can drop the row.
  onEdit?: (tx: Transaction) => void;
  onDeleted?: (txId: string) => void;
}

function formatAmount(amount: string, type: string, currency = "TRY"): string {
  const num = parseFloat(amount);
  try {
    const formatted = new Intl.NumberFormat(undefined, {
      style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(num);
    return type === "credit" ? `+${formatted}` : `-${formatted}`;
  } catch {
    const formatted = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
    return `${type === "credit" ? "+" : "-"}${formatted} ${currency}`;
  }
}

function formatDate(raw: string): string {
  const d = new Date(`${raw}T00:00:00`);
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
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

export default function TransactionTable({ transactions, onCategoryCorrection, onEdit, onDeleted }: TransactionTableProps) {
  const { t } = useLanguage();
  const [rows, setRows] = useState<Record<string, RowState>>(() => {
    const init: Record<string, RowState> = {};
    for (const tx of transactions) {
      init[tx.id] = { category: tx.category, notes: [], notesLoaded: false, expanded: false, saving: false, error: null };
    }
    return init;
  });

  if (transactions.length === 0) {
    return (
      <div className="text-center py-16 bg-surface border border-line rounded-xl">
        <p className="text-ink-mute text-sm">{t("tx.empty")}</p>
        <p className="text-ink-mute text-xs mt-1">{t("tx.emptyHint")}</p>
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
        [id]: { ...prev[id], saving: false, error: err instanceof Error ? err.message : t("common.error") },
      }));
    }
  };

  const handleNoteAdded = (txId: string, note: NoteResponse) => {
    setRows((prev) => ({ ...prev, [txId]: { ...prev[txId], notes: [...prev[txId].notes, note] } }));
  };

  const handleDelete = async (tx: Transaction) => {
    if (!window.confirm(t("tx.deleteConfirm"))) return;
    setRows((prev) => ({ ...prev, [tx.id]: { ...prev[tx.id], saving: true, error: null } }));
    try {
      await deleteTransaction(tx.id);
      onDeleted?.(tx.id);
      window.dispatchEvent(new Event("mizan-data-changed"));
    } catch (err) {
      setRows((prev) => ({
        ...prev,
        [tx.id]: { ...prev[tx.id], saving: false, error: err instanceof Error ? err.message : t("common.error") },
      }));
    }
  };

  return (
    <div>
      <p className="text-[11px] text-ink-mute mb-2 flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-[#176B5B]" />
        {t("tx.tapHint")}
      </p>
      <div className="rounded-xl border border-line overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-surface-2 border-b border-line">
            <th className="px-4 py-3 text-left text-xs font-medium text-ink-mute uppercase tracking-wide w-28">{t("tx.date")}</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-ink-mute uppercase tracking-wide">{t("tx.description")}</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-ink-mute uppercase tracking-wide w-36">{t("common.amount")}</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-ink-mute uppercase tracking-wide w-36">{t("goals.category")}</th>
            <th className="px-4 py-3 w-8" />
          </tr>
        </thead>
        <tbody>
          {transactions.map((tx) => {
            const row = rows[tx.id] ?? {
              category: tx.category, notes: [], notesLoaded: false, expanded: false, saving: false, error: null,
            };
            return (
              <Fragment key={tx.id}>
                <tr
                  className="bg-surface hover:bg-[#176B5B]/[0.05] transition-colors duration-100 cursor-pointer group border-b border-line last:border-0"
                  onClick={() => void toggleExpand(tx.id)}
                >
                  <td className="px-4 py-3.5 whitespace-nowrap">
                    <span className="text-xs text-ink-mute">{formatDate(tx.transaction_date)}</span>
                  </td>
                  <td className="px-4 py-3.5 max-w-0">
                    <p className="text-ink-soft text-sm truncate" title={tx.description}>{tx.description}</p>
                  </td>
                  <td className="px-4 py-3.5 text-right whitespace-nowrap">
                    <span className={`text-sm font-semibold tabular-nums ${tx.transaction_type === "credit" ? "text-pos" : "text-neg"}`}>
                      {formatAmount(tx.amount, tx.transaction_type, tx.currency)}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <CategoryBadge category={row.category} />
                  </td>
                  <td className="px-3 py-3.5">
                    <span className={`flex items-center justify-center transition-colors ${row.expanded ? "text-[#176B5B]" : "text-ink-mute group-hover:text-[#176B5B]"}`}>
                      <ChevronIcon open={row.expanded} />
                    </span>
                  </td>
                </tr>

                {row.expanded && (
                  <tr key={`${tx.id}-detail`} className="bg-surface-2 border-b border-line">
                    <td colSpan={5} className="px-5 py-5">
                      <div className="flex items-start justify-between mb-5 pb-4 border-b border-line">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-ink-mute uppercase tracking-wider mb-1">{t("tx.detail")}</p>
                          <p className="text-sm text-ink leading-relaxed">{tx.description}</p>
                        </div>
                        <div className="text-right shrink-0 ml-4">
                          <p className={`text-base font-bold tabular-nums ${tx.transaction_type === "credit" ? "text-pos" : "text-neg"}`}>
                            {formatAmount(tx.amount, tx.transaction_type, tx.currency)}
                          </p>
                          <p className="text-xs text-ink-mute mt-0.5">{formatDate(tx.transaction_date)}</p>
                          <div className="flex items-center justify-end gap-2 mt-2.5">
                            <button
                              onClick={() => onEdit?.(tx)}
                              disabled={row.saving}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-line text-xs font-medium text-ink-soft hover:text-[#176B5B] hover:border-[#176B5B]/50 transition-colors disabled:opacity-40"
                            >
                              <Pencil size={13} /> {t("common.edit")}
                            </button>
                            <button
                              onClick={() => void handleDelete(tx)}
                              disabled={row.saving}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-line text-xs font-medium text-ink-soft hover:text-danger hover:border-danger/50 transition-colors disabled:opacity-40"
                            >
                              <X size={13} /> {t("common.delete")}
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="mb-5">
                        <p className="text-xs font-semibold text-ink-mute uppercase tracking-wider mb-2.5">
                          {t("tx.fixCategory")}
                          {row.saving && <span className="ml-2 text-[#176B5B] normal-case font-normal">{t("common.saving")}</span>}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {CATEGORIES.map((cat) => {
                            const isActive = row.category === cat;
                            const key = `category.${cat}`;
                            const label = t(key) !== key ? t(key) : cat;
                            return (
                              <button
                                key={cat}
                                disabled={row.saving}
                                onClick={() => void handleCategoryChange(tx.id, cat)}
                                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors disabled:opacity-40 ${
                                  isActive
                                    ? "bg-[#176B5B] text-white shadow-sm"
                                    : "bg-surface border border-line text-ink-soft hover:border-[#176B5B] hover:text-[#176B5B]"
                                }`}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                        {row.error && <p className="text-xs text-neg mt-2">{row.error}</p>}
                      </div>

                      <div>
                        <p className="text-xs font-semibold text-ink-mute uppercase tracking-wider mb-2">{t("common.notes")}</p>
                        <NoteInput
                          transactionId={tx.id}
                          existingNotes={row.notes}
                          onNoteAdded={(note) => handleNoteAdded(tx.id, note)}
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
    </div>
  );
}
