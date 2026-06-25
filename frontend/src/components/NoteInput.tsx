"use client";

import { useState } from "react";
import { addNote, type NoteResponse } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";

const MAX_CHARS = 300;

interface NoteInputProps {
  transactionId: string;
  existingNotes: NoteResponse[];
  onNoteAdded: (note: NoteResponse) => void;
}

function timeAgo(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export default function NoteInput({ transactionId, existingNotes, onNoteAdded }: NoteInputProps) {
  const { t } = useLanguage();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remaining = MAX_CHARS - text.length;

  const handleSave = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      const note = await addNote(transactionId, trimmed);
      onNoteAdded(note);
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      {existingNotes.length > 0 && (
        <ul className="space-y-1.5">
          {existingNotes.map((n) => (
            <li key={n.id} className="flex items-start gap-2 text-xs bg-canvas border border-line rounded-lg px-3 py-2">
              <span className="text-ink-soft flex-1 leading-relaxed">{n.note_text}</span>
              {"created_at" in n && typeof (n as { created_at?: string }).created_at === "string" && (
                <span className="text-ink-mute shrink-0 mt-0.5">{timeAgo((n as { created_at: string }).created_at)}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-1.5">
        <textarea
          rows={2}
          value={text}
          maxLength={MAX_CHARS}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSave();
            }
          }}
          placeholder={t("common.notes") + "..."}
          className="w-full resize-none rounded-lg bg-canvas border border-line text-xs text-ink-soft placeholder-gray-700 px-3 py-2 focus:outline-none focus:border-brand transition-colors leading-relaxed"
        />
        <div className="flex items-center justify-between">
          <span className={`text-xs ${remaining < 50 ? "text-amber-500" : "text-gray-700"}`}>
            {remaining}
          </span>
          <button
            onClick={() => void handleSave()}
            disabled={saving || !text.trim()}
            className="px-3 py-1 rounded-lg bg-brand hover:bg-brand-hover disabled:opacity-40 text-xs font-medium text-white transition-colors"
          >
            {saving ? t("common.loading") : t("common.save")}
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-neg">{error}</p>}
    </div>
  );
}
