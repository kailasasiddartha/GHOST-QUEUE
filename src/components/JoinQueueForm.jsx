import React, { useState } from "react";
import { useLocale } from "../utils/i18n";

export default function JoinQueueForm({ onJoin, storeName, initialProfile = {} }) {
  const { t } = useLocale();
  const [name, setName] = useState(initialProfile?.name || "");
  const [phone, setPhone] = useState(initialProfile?.phone || "");
  const [members, setMembers] = useState(initialProfile?.members || 1);
  const [partyNote, setPartyNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const normalizePhone = (value) => value.replace(/[^0-9]/g, "").slice(0, 10);

  const handleMembersInput = (value) => {
    if (value === "") {
      setMembers("");
      return;
    }

    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
      return;
    }

    setMembers(Math.min(20, Math.max(1, parsed)));
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError("Please enter your name");
      return;
    }

    const cleanedPhone = phone.replace(/\D/g, "");
    if (cleanedPhone.length !== 10) {
      setError("Phone number must be exactly 10 digits");
      return;
    }

    const normalizedMembers = Number(members);
    if (!Number.isInteger(normalizedMembers) || normalizedMembers < 1 || normalizedMembers > 20) {
      setError("Members must be 1-20");
      return;
    }

    setLoading(true);
    setError("");

    try {
      await onJoin({
        name: name.trim(),
        phone: cleanedPhone,
        members: normalizedMembers,
        party_note: partyNote.trim(),
      });
    } catch (err) {
      setError(err.message || "Failed to join queue");
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-[420px] space-y-6">
      <div className="text-center space-y-1">
        <p className="text-on-surface-variant text-xs font-label uppercase tracking-[0.15em]">
          {storeName}
        </p>
        <h2 className="text-3xl font-headline font-bold text-on-surface">
          {t("joinQueue", "Join Queue")}
        </h2>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-on-surface-variant font-label uppercase tracking-widest">
          {t("yourName", "Your name")}
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError("");
          }}
          placeholder="e.g. Arjun"
          maxLength={40}
          className="w-full bg-surface-container-highest text-on-surface placeholder:text-on-surface-variant/40 rounded-lg px-4 py-3 border-none outline-none focus:ring-2 focus:ring-primary-container/60 font-body text-base"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs text-on-surface-variant font-label uppercase tracking-widest">
          {t("phoneNumber", "Phone number")}
        </label>
        <input
          type="tel"
          inputMode="numeric"
          pattern="\d{10}"
          autoComplete="tel"
          value={phone}
          onChange={(e) => {
            setPhone(normalizePhone(e.target.value));
            if (error) setError("");
          }}
          onInput={(e) => {
            const nextValue = normalizePhone(e.currentTarget.value);
            if (nextValue !== phone) {
              setPhone(nextValue);
            }
          }}
          onPaste={(e) => {
            e.preventDefault();
            const pastedValue = normalizePhone(e.clipboardData.getData("text"));
            setPhone(pastedValue);
          }}
          onKeyDown={(e) => {
            const allowedKeys = ["Backspace", "Delete", "ArrowLeft", "ArrowRight", "Tab"];
            if (allowedKeys.includes(e.key)) {
              return;
            }
            if (!/^\d$/.test(e.key)) {
              e.preventDefault();
            }
          }}
          placeholder="e.g. 9876543210"
          maxLength={10}
          className="w-full bg-surface-container-highest text-on-surface placeholder:text-on-surface-variant/40 rounded-lg px-4 py-3 border-none outline-none focus:ring-2 focus:ring-primary-container/60 font-body text-base"
        />
        <p className="text-[10px] text-on-surface-variant text-right">10 digits only</p>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-on-surface-variant font-label uppercase tracking-widest">
          {t("members", "Number of members")}
        </label>
        <div className="flex items-center gap-4 bg-surface-container-highest rounded-lg px-4 py-3">
          <button
            type="button"
            onClick={() => setMembers((m) => Math.max(1, Number(m || 1) - 1))}
            className="w-8 h-8 rounded-full bg-surface-container-high text-on-surface font-bold text-lg flex items-center justify-center active:scale-90 transition-transform"
          >
            -
          </button>
          <input
            type="number"
            min="1"
            max="20"
            inputMode="numeric"
            value={members}
            onChange={(e) => {
              handleMembersInput(e.target.value);
              if (error) setError("");
            }}
            className="flex-1 bg-transparent text-center text-2xl font-headline font-bold text-on-surface outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <button
            type="button"
            onClick={() => setMembers((m) => Math.min(20, Math.max(1, Number(m || 1)) + 1))}
            className="w-8 h-8 rounded-full bg-surface-container-high text-on-surface font-bold text-lg flex items-center justify-center active:scale-90 transition-transform"
          >
            +
          </button>
        </div>
        <p className="text-[10px] text-on-surface-variant text-right">max 20</p>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-on-surface-variant font-label uppercase tracking-widest">
          {t("partyNotes", "Party notes")} ({t("optional", "Optional")})
        </label>
        <textarea
          value={partyNote}
          onChange={(e) => {
            setPartyNote(e.target.value.slice(0, 120));
            if (error) setError("");
          }}
          rows={3}
          placeholder="e.g. wheelchair, takeaway, table for 4"
          className="w-full resize-none bg-surface-container-highest text-on-surface placeholder:text-on-surface-variant/40 rounded-lg px-4 py-3 border-none outline-none focus:ring-2 focus:ring-primary-container/60 font-body text-sm"
        />
      </div>

      {error && <p className="text-error text-xs text-center">{error}</p>}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={loading}
        className="w-full py-4 rounded-xl font-headline font-bold text-base uppercase tracking-widest text-white bg-gradient-to-r from-primary-container to-secondary shadow-[0_8px_32px_0_rgba(124,58,237,0.3)] active:scale-95 transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Joining..." : "Join Queue"}
      </button>
    </div>
  );
}
