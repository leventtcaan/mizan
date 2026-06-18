"use client";

import { useState } from "react";
import { addNote, type NoteResponse } from "@/lib/api";

interface NoteInputProps {
  transactionId: string;
  existingNotes: NoteResponse[];
  onNoteAdded: (note: NoteResponse) => void;
}

export default function NoteInput({ transactionId, existingNotes, onNoteAdded }: NoteInputProps) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setError(err instanceof Error ? err.message : "Kaydedemedik");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 space-y-2">
      {existingNotes.length > 0 && (
        <ul className="space-y-1">
          {existingNotes.map((n) => (
            <li key={n.id} className="text-xs text-gray-400 bg-gray-800 rounded px-2 py-1">
              {n.note_text}
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <textarea
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSave();
            }
          }}
          placeholder="Not ekle... (Enter ile kaydet)"
          className="flex-1 resize-none rounded bg-gray-800 border border-gray-700 text-xs text-gray-200 placeholder-gray-600 px-2 py-1 focus:outline-none focus:border-indigo-500"
        />
        <button
          onClick={() => void handleSave()}
          disabled={saving || !text.trim()}
          className="px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-xs font-medium transition-colors"
        >
          {saving ? "…" : "Kaydet"}
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
