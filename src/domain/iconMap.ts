// v0.8 replaced category emoji with Lucide icons. This maps each emoji the old picker offered (and a few
// common pasted ones) to the closest icon, for migration 8. Anything not listed loses its icon.
export const EMOJI_TO_ICON: Record<string, string> = {
  // Work
  "💼": "briefcase", "💻": "laptop", "🖥️": "monitor", "🖥": "monitor", "⌨️": "keyboard", "⌨": "keyboard", "🖱️": "mouse", "🖱": "mouse", "📧": "mail", "✉️": "mail",
  "📞": "phone", "☎️": "phone", "📅": "calendar", "📆": "calendar", "🗓️": "calendar-days", "🗓": "calendar-days", "📝": "notebook-pen", "📋": "file-text",
  "📄": "file-text", "📊": "chart-column", "📈": "trending-up", "🧾": "receipt", "💰": "wallet", "💸": "banknote", "💵": "banknote", "🏦": "landmark",
  "📦": "package", "🗂️": "folder-open", "🗂": "folder-open", "📁": "folder-open", "📂": "folder-open", "📌": "pin", "📍": "pin", "✅": "circle-check",
  "✔️": "circle-check", "🎯": "target", "⏱️": "timer", "⏱": "timer", "⏰": "alarm-clock", "🔔": "bell", "🤝": "handshake", "👥": "users",
  // Create
  "🎨": "palette", "🖌️": "brush", "🖌": "brush", "✏️": "pencil", "✏": "pencil", "🖊️": "pen", "🖊": "pen", "✍️": "pen-line", "✍": "pen-line",
  "🎬": "clapperboard", "🎥": "video", "📷": "camera", "📸": "camera", "🎞️": "film", "🎞": "film", "🧊": "cuboid", "🔮": "sparkles", "💡": "lightbulb",
  "🧠": "brain", "🧪": "flask-conical", "🛠️": "wrench", "🛠": "wrench", "🔧": "wrench", "🔨": "hammer", "⚙️": "settings", "⚙": "settings", "🧩": "puzzle",
  "🎮": "gamepad-2", "🕹️": "joystick", "🕹": "joystick", "🎵": "music", "🎶": "music", "🎧": "headphones", "🎸": "guitar", "🎹": "piano", "📐": "ruler",
  "📏": "ruler", "🌀": "spline", "✨": "sparkles",
  // Learn
  "📚": "library", "📖": "book-open", "📕": "book", "📗": "book", "📘": "book", "🎓": "graduation-cap", "🔬": "microscope", "🔭": "telescope",
  "🌍": "globe", "🌎": "globe", "🌏": "globe", "🗣️": "languages", "🗣": "languages", "🧮": "calculator", "💬": "message-circle", "📰": "newspaper",
  "🔍": "search", "🔎": "search", "🗺️": "map", "🗺": "map", "🧭": "compass",
  // Life
  "🏃": "activity", "🏃‍♂️": "activity", "🏃‍♀️": "activity", "🏋️": "dumbbell", "🏋": "dumbbell", "🏋️‍♂️": "dumbbell", "🏋️‍♀️": "dumbbell", "🚴": "bike",
  "🧘": "leaf", "🚶": "footprints", "🐕": "dog", "🐶": "dog", "🐾": "paw-print", "🐈": "cat", "🐱": "cat", "🛌": "bed", "😴": "moon", "🍳": "cooking-pot",
  "🥗": "salad", "🍽️": "utensils", "🍽": "utensils", "🍴": "utensils", "☕": "coffee", "🍵": "coffee", "💧": "droplet", "🧹": "sparkles", "🧺": "washing-machine",
  "🛒": "shopping-cart", "🛍️": "shopping-bag", "❤️": "heart", "❤": "heart", "♥️": "heart", "👫": "heart", "👪": "users", "🏠": "house", "🏡": "house",
  "🚗": "car", "🚌": "bus", "🚆": "train-front", "✈️": "plane", "✈": "plane", "🌳": "trees", "🌲": "tree-pine", "🌿": "leaf", "🌸": "flower-2",
  "☀️": "sun", "☀": "sun", "🌙": "moon", "🌅": "sunrise", "💊": "pill", "🩺": "stethoscope", "😊": "smile", "🙂": "smile", "👤": "user",
  // Fun
  "🍿": "popcorn", "📺": "tv", "🎲": "dice-5", "🎤": "mic", "🎙️": "mic", "🎙": "mic", "🎭": "drama", "🖼️": "image", "🖼": "image", "📻": "radio",
  "📱": "smartphone", "🎉": "party-popper", "🍻": "beer", "🍺": "beer", "🍷": "wine", "🎁": "gift", "🎟️": "ticket", "🎫": "ticket", "🧸": "smile",
  // Symbols
  "🔥": "flame", "⚡": "zap", "⭐": "star", "🌟": "sparkle", "🚀": "rocket", "💎": "gem", "🏆": "trophy", "🥇": "medal", "🏅": "medal", "👑": "crown",
  "🔒": "lock", "⚠️": "triangle-alert", "⚠": "triangle-alert", "❗": "circle-alert", "❓": "circle-help", "⏳": "hourglass", "♾️": "infinity",
  "🏁": "flag", "🚩": "flag", "⛰️": "mountain", "🏔️": "mountain", "🌊": "waves", "❄️": "snowflake", "☔": "umbrella", "👻": "ghost", "💀": "skull",
};

/** SQL that sets categories.icon from categories.emoji (unknown emoji → NULL). */
export function emojiToIconSql(): string {
  const esc = (s: string) => s.replace(/'/g, "''");
  const cases = Object.entries(EMOJI_TO_ICON)
    .map(([e, i]) => `WHEN '${esc(e)}' THEN '${esc(i)}'`)
    .join(" ");
  return `UPDATE categories SET icon = CASE TRIM(COALESCE(emoji, '')) ${cases} ELSE NULL END`;
}
