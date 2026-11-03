"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";

const EMOJI_GROUPS = {
  Smileys: ["😀","😃","😄","😁","😆","😅","😂","🤣","😊","😇","🙂","🙃","😉","😌","😍","🥰","😘","😋","😛","😜","🤪","🤨","🧐","🤓","😎","🥳","😏","😒","😞","😔","😟","😕","🙁","☹️","😣","😖","😫","😩","🥺","😢","😭","😤","😠","😡","🤬","🤯","😳","🥵","🥶","😱","😨","😰","😥","🤔","🤭","🤫","🤥","😶","😐","😑","😬","🙄","😴","🤤","😷","🤒","🤕"],
  People: ["👋","🤚","🖐️","✋","🖖","👌","🤌","🤏","✌️","🤞","🤟","🤘","🤙","👈","👉","👆","👇","☝️","👍","👎","✊","👊","🤛","🤜","👏","🙌","👐","🤲","🤝","🙏","✍️","💅","🤳","💪","🦾","👀","👁️","👄","🧠","🫶"],
  Nature: ["🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐯","🦁","🐮","🐷","🐸","🐵","🐔","🐧","🐦","🦄","🐝","🦋","🌸","🌹","🌻","🌞","⭐","🌟","✨","⚡","🔥","🌈","☀️","🌙"],
  Food: ["🍏","🍎","🍐","🍊","🍋","🍌","🍉","🍇","🍓","🫐","🍒","🥝","🍅","🥑","🍕","🍔","🍟","🌭","🍿","🍩","🍪","🎂","🍰","☕","🍵","🥤","🍺","🥂"],
  Activities: ["⚽","🏀","🏈","⚾","🎾","🏐","🏆","🥇","🎯","🎮","🎲","🎨","🎬","🎤","🎧","🎸","🎹","🎉","🎊","🎁","🎈"],
  Travel: ["🚗","🚕","🚌","🚎","🏎️","🚓","🚑","🚒","🚲","✈️","🚀","🚁","⛵","🚢","🏠","🏢","🏥","🏦","🏨","🗺️","🏝️","🌋"],
  Objects: ["⌚","📱","💻","⌨️","🖥️","🖨️","📷","🎥","☎️","💡","📚","📌","📎","✂️","🔒","🔑","🔨","🧰","🧲","🧪","💊","💰","💳","✉️","📦"],
  Symbols: ["❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","❣️","💕","💞","💓","💗","💖","💘","💝","💟","✅","❌","⭕","💯","‼️","❓","❗","⚠️","♻️","➕","➖","➡️","⬅️","⬆️","⬇️"],
} as const;

const EMOJI_SEARCH: Record<string, string> = {
  "😀": "smile happy grin", "😂": "laugh tears joy", "😍": "love heart eyes",
  "😘": "kiss love", "😢": "sad cry tear", "😭": "cry sob", "😡": "angry mad",
  "🤔": "think thinking", "👍": "thumb up like yes", "👎": "thumb down dislike no",
  "👏": "clap applause", "🙏": "pray please thanks", "🤝": "handshake agreement",
  "👋": "wave hello goodbye", "💪": "strong muscle", "🔥": "fire hot",
  "✨": "sparkle shine", "🎉": "party celebrate", "❤️": "heart love red",
  "✅": "check done yes", "❌": "cross no wrong", "⭐": "star favorite",
  "📌": "pin", "📎": "paperclip attachment", "📷": "camera photo", "🎥": "video camera",
  "💯": "hundred perfect", "⚠️": "warning alert", "🎁": "gift present",
};

export default function MessagingEmojiPicker({
  onSelect,
  open: controlledOpen,
  onOpenChange,
}: {
  onSelect: (emoji: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [category, setCategory] = useState<keyof typeof EMOJI_GROUPS>("Smileys");
  const [query, setQuery] = useState("");
  const open = controlledOpen ?? internalOpen;
  const setOpen = (next: boolean) => {
    setInternalOpen(next);
    onOpenChange?.(next);
  };
  const emojis = useMemo(
    () => {
      const normalized = query.trim().toLowerCase();
      if (!normalized) return [...EMOJI_GROUPS[category]];
      return Object.entries(EMOJI_GROUPS).flatMap(([group, items]) =>
        items.filter((emoji) =>
          group.toLowerCase().includes(normalized)
          || emoji.includes(normalized)
          || (EMOJI_SEARCH[emoji] ?? "").includes(normalized),
        ),
      );
    },
    [category, query],
  );

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full text-lg text-[#4b5563] hover:bg-[#eef2ff]"
        aria-label="Insert emoji"
        aria-expanded={open}
      >
        😊
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-30 mb-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-[#e5e7eb] bg-white p-2 shadow-xl">
          <div className="relative mb-2">
            <Search className="absolute left-2 top-2 h-4 w-4 text-[#9ca3af]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search emojis"
              className="w-full rounded-lg border border-[#e5e7eb] py-1.5 pl-8 pr-2 text-xs outline-none focus:border-[#2A4792]"
            />
          </div>
          <div className="mb-2 flex gap-1 overflow-x-auto pb-1">
            {Object.keys(EMOJI_GROUPS).map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => { setCategory(name as keyof typeof EMOJI_GROUPS); setQuery(""); }}
                className={`rounded-full px-2 py-1 text-[10px] whitespace-nowrap ${category === name && !query ? "bg-[#2A4792] text-white" : "bg-[#f3f4f6] text-[#4b5563]"}`}
              >
                {name}
              </button>
            ))}
          </div>
          <div className="grid max-h-56 grid-cols-8 gap-1 overflow-y-auto">
            {emojis.map((emoji) => (
              <button
                key={`${category}-${emoji}`}
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-md text-base hover:bg-[#f3f4f6]"
                onClick={() => {
                  onSelect(emoji);
                  setOpen(false);
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
