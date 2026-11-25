// Compact offline emoji picker: a curated set with keyword search. No network, no font downloads;
// emoji render with the system font (Segoe UI Emoji on Windows).
import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";

type E = [emoji: string, keywords: string];
const GROUPS: { name: string; items: E[] }[] = [
  {
    name: "Work",
    items: [
      ["💼", "work job client business briefcase"], ["💻", "laptop computer code dev"], ["🖥️", "desktop computer monitor"], ["⌨️", "keyboard typing"],
      ["🖱️", "mouse"], ["📧", "email mail inbox"], ["📞", "call phone"], ["📅", "calendar date schedule"], ["🗓️", "planner calendar"], ["📝", "notes write memo"],
      ["📋", "clipboard tasks admin"], ["📊", "chart stats report"], ["📈", "growth up trend"], ["🧾", "invoice receipt tax"], ["💰", "money finance budget"],
      ["💸", "spend money pay debt"], ["🏦", "bank finance zus"], ["📦", "delivery package ship"], ["🗂️", "files folders organise"], ["📌", "pin important"],
      ["✅", "done check task"], ["🎯", "goal target focus"], ["⏱️", "timer stopwatch"], ["⏰", "alarm clock"], ["🔔", "bell reminder"], ["🤝", "meeting deal"],
    ],
  },
  {
    name: "Create",
    items: [
      ["🎨", "art paint design colour"], ["🖌️", "brush paint draw"], ["✏️", "pencil draw sketch"], ["🖊️", "pen write"], ["✍️", "writing hand journal"],
      ["🎬", "film movie edit motion"], ["🎥", "camera video shoot"], ["📷", "photo camera"], ["🎞️", "film frames animation"], ["🧊", "3d cube render cinema4d"],
      ["🔮", "render magic houdini"], ["💡", "idea light bulb"], ["🧠", "brain think learn"], ["🧪", "experiment test lab"], ["🛠️", "tools build fix"],
      ["⚙️", "settings gear engine"], ["🧩", "puzzle problem"], ["🎮", "game gaming unreal"], ["🕹️", "joystick game"], ["🎵", "music note"],
      ["🎧", "headphones music audio"], ["🎸", "guitar music"], ["🎹", "piano keys music"], ["📐", "layout geometry design"], ["🌀", "motion swirl"], ["✨", "sparkles polish fx"],
    ],
  },
  {
    name: "Learn",
    items: [
      ["📚", "books study read"], ["📖", "book read"], ["🎓", "study course graduate"], ["🔬", "research science"], ["🌍", "language world"],
      ["🗣️", "speak language talk"], ["🧮", "math abacus"], ["💬", "chat discuss"], ["📰", "news read"], ["🔍", "search research"], ["🗺️", "map explore plan"],
    ],
  },
  {
    name: "Life",
    items: [
      ["🏃", "run exercise cardio"], ["🏋️", "gym weights lift"], ["🚴", "bike cycle"], ["🧘", "yoga meditate calm"], ["🚶", "walk"], ["🐕", "dog walk pet"],
      ["🐾", "paws pets dogs"], ["🛌", "sleep rest bed"], ["😴", "sleep tired nap"], ["🍳", "cook breakfast kitchen"], ["🥗", "salad healthy food"],
      ["🍽️", "dinner meal eat"], ["☕", "coffee break"], ["🍵", "tea break"], ["💧", "water hydrate"], ["🧹", "clean tidy chores"], ["🧺", "laundry chores"],
      ["🛒", "shopping groceries"], ["❤️", "love heart partner"], ["👫", "together partner date"], ["👪", "family"], ["🏠", "home house"], ["🚗", "car drive commute"],
      ["✈️", "travel flight"], ["🌳", "nature outside park"], ["☀️", "sun morning day"], ["🌙", "night moon evening"], ["💊", "health medicine"], ["🩺", "doctor health"],
    ],
  },
  {
    name: "Fun",
    items: [
      ["🍿", "movie film watch"], ["📺", "tv show series"], ["🎲", "board game dice"], ["🎤", "sing karaoke"], ["🎭", "theatre culture"], ["🖼️", "gallery museum art"],
      ["📻", "radio podcast"], ["🎙️", "podcast mic record"], ["📱", "phone social scroll"], ["🎉", "party celebrate"], ["🍻", "drinks friends"], ["🧸", "play toy"],
    ],
  },
  {
    name: "Symbols",
    items: [
      ["🔥", "fire hot urgent"], ["⚡", "energy fast lightning"], ["⭐", "star favourite"], ["🌟", "star shine"], ["🚀", "launch ship rocket"], ["💎", "gem premium"],
      ["🏆", "trophy win award"], ["🎁", "gift"], ["🔒", "lock private"], ["🧭", "compass direction"], ["⚠️", "warning"], ["❗", "important"], ["❓", "question"],
      ["🔴", "red circle"], ["🟠", "orange circle"], ["🟡", "yellow circle"], ["🟢", "green circle"], ["🔵", "blue circle"], ["🟣", "purple circle"], ["⚫", "black circle"], ["⚪", "white circle"],
    ],
  },
];
export const EMOJI_COUNT = GROUPS.reduce((n, g) => n + g.items.length, 0);

const LEADING = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:️|‍|\p{Extended_Pictographic}|\p{Emoji_Modifier})*\s*/u;

export const leadingEmoji = (s: string | null | undefined) => (s ? (s.match(LEADING)?.[0].trim() ?? null) : null);
export const startsWithEmoji = (s: string | null | undefined) => !!s && LEADING.test(s);

/** Put `emoji` in front of a title, replacing any emoji already there. `null` removes it. */
export function withLeadingEmoji(title: string | null | undefined, emoji: string | null): string {
  const rest = (title ?? "").replace(LEADING, "").trim();
  return emoji ? `${emoji} ${rest}`.trim() : rest;
}

export function EmojiPicker({ onPick, onClose, canClear, className }: { onPick: (emoji: string | null) => void; onClose: () => void; canClear?: boolean; className?: string }) {
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), onClose());
    // Defer so the click that opened the picker doesn't immediately close it
    const t = setTimeout(() => document.addEventListener("pointerdown", down), 0);
    document.addEventListener("keydown", key, true);
    return () => (clearTimeout(t), document.removeEventListener("pointerdown", down), document.removeEventListener("keydown", key, true));
  }, [onClose]);

  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return GROUPS;
    const hits = GROUPS.flatMap((g) => g.items).filter(([e, k]) => e === term || k.split(" ").some((w) => w.startsWith(term)));
    return [{ name: "Results", items: hits }];
  }, [q]);

  const pick = (e: string | null) => (onPick(e), onClose());
  return (
    <div ref={ref} className={`popover emoji-picker ${className ?? ""}`} role="dialog" aria-label="Pick an emoji" onMouseDown={(e) => e.stopPropagation()}>
      <div className="emoji-search">
        <input
          ref={input}
          className="field sm"
          placeholder="Search: coffee, dog, render…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const first = groups[0]?.items[0];
              if (first) pick(first[0]);
            }
          }}
          aria-label="Search emoji"
        />
        {canClear && (
          <button className="icon-btn sm" onClick={() => pick(null)} title="Remove icon" aria-label="Remove icon">
            <X size={13} />
          </button>
        )}
      </div>
      <div className="emoji-scroll">
        {groups.map((g) => (
          <div key={g.name}>
            <div className="emoji-group">{g.name}</div>
            <div className="emoji-grid">
              {g.items.map(([e, k]) => (
                <button key={e} className="emoji-btn" onClick={() => pick(e)} title={k.split(" ")[0]} aria-label={`${k.split(" ")[0]} ${e}`}>
                  {e}
                </button>
              ))}
            </div>
          </div>
        ))}
        {groups[0]?.items.length === 0 && <div className="muted small emoji-empty">Nothing for “{q}”. Paste any emoji into the name instead.</div>}
      </div>
    </div>
  );
}
