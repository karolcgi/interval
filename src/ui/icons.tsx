// The icon set for categories, presets and blocks (v0.8): a curated slice of Lucide, the same line icons
// the rest of the UI uses. Bundled and offline. Icons are stored by their Lucide name ("graduation-cap"),
// so the set can grow without a migration; an unknown name simply renders as the colour dot.
import {
  Activity, AlarmClock, Anchor, Aperture, Apple, Armchair, Atom, Baby, Banknote, Bath, Bed, Beer, Bell, Bike, Bird, Book, BookOpen, Box, Boxes,
  Brain, Briefcase, Brush, Bug, Bus, Calculator, Calendar, CalendarDays, Camera, Car, Cat, ChartColumn, ChefHat, CircleAlert, CircleCheck,
  CircleHelp, Clapperboard, Cloud, CloudRain, Code, Coffee, Compass, CookingPot, Crown, Cuboid, CupSoda, Database, Dice5, Dog, Drama, Droplet,
  Dumbbell, Feather, FileText, Film, Fish, Flag, FlaskConical, Flame, Flower2, FolderOpen, Footprints, Frame, Gamepad2, Gem, Ghost, Gift,
  GitBranch, Glasses, Globe, GraduationCap, Guitar, Hammer, Handshake, Headphones, Heart, HeartPulse, Hourglass, House, Image, Inbox, Infinity,
  Joystick, Keyboard, Landmark, Languages, Laptop, Layers, Leaf, Library, Lightbulb, Lock, Mail, Map, Medal, MessageCircle, Mic, Microscope,
  Monitor, Moon, Mountain, Mouse, Music, Newspaper, NotebookPen, Orbit, Package, Palette, PartyPopper, PawPrint, Pen, PenLine, PenTool, Pencil,
  Phone, Piano, Pill, Pin, Plane, Podcast, Popcorn, Presentation, Puzzle, Radio, Receipt, Rocket, Ruler, Salad, School, Scissors, Search, Send,
  Server, Settings, Shapes, Shirt, ShoppingBag, ShoppingCart, Skull, Smartphone, Smile, Snowflake, Sofa, Sparkle, Sparkles, Spline, Star,
  Stethoscope, StickyNote, Sun, Sunrise, Sunset, Target, Telescope, Terminal, Ticket, Timer, TrainFront, Trees, TreePine, TrendingUp,
  TriangleAlert, Trophy, Tv, Umbrella, User, Users, Utensils, Video, Wallet, Wand, WashingMachine, Waves, Wine, Wrench, Zap,
  type LucideIcon,
} from "lucide-react";

type Entry = [name: string, icon: LucideIcon, keywords: string];

export const ICON_GROUPS: { name: string; items: Entry[] }[] = [
  {
    name: "Work",
    items: [
      ["briefcase", Briefcase, "work job client business freelance"], ["laptop", Laptop, "computer code dev"], ["monitor", Monitor, "desktop screen"],
      ["keyboard", Keyboard, "typing"], ["mouse", Mouse, "click"], ["mail", Mail, "email inbox"], ["inbox", Inbox, "email mail"], ["send", Send, "message deliver"],
      ["phone", Phone, "call"], ["calendar", Calendar, "date schedule plan"], ["calendar-days", CalendarDays, "planner week"], ["notebook-pen", NotebookPen, "notes journal write"],
      ["sticky-note", StickyNote, "note memo"], ["file-text", FileText, "document admin paperwork"], ["chart-column", ChartColumn, "stats report chart"],
      ["trending-up", TrendingUp, "growth trend progress"], ["receipt", Receipt, "invoice tax bill"], ["wallet", Wallet, "money budget finance"],
      ["banknote", Banknote, "money cash pay debt"], ["landmark", Landmark, "bank zus office government"], ["package", Package, "delivery ship parcel"],
      ["folder-open", FolderOpen, "files organise"], ["pin", Pin, "important"], ["circle-check", CircleCheck, "done task check"], ["target", Target, "goal focus"],
      ["timer", Timer, "stopwatch time"], ["alarm-clock", AlarmClock, "alarm wake"], ["bell", Bell, "reminder"], ["handshake", Handshake, "meeting deal client"],
      ["users", Users, "team meeting people"], ["presentation", Presentation, "pitch slides review"], ["code", Code, "programming dev"],
      ["terminal", Terminal, "shell script dev"], ["bug", Bug, "debug fix"], ["database", Database, "data"], ["server", Server, "render farm"],
      ["cloud", Cloud, "upload sync"], ["git-branch", GitBranch, "version code"],
    ],
  },
  {
    name: "Create",
    items: [
      ["palette", Palette, "art paint design colour"], ["brush", Brush, "paint draw"], ["pencil", Pencil, "draw sketch"], ["pen", Pen, "write"],
      ["pen-line", PenLine, "write sign"], ["pen-tool", PenTool, "vector design illustrator"], ["feather", Feather, "writing light"],
      ["clapperboard", Clapperboard, "film movie edit motion"], ["video", Video, "camera shoot record"], ["camera", Camera, "photo"], ["film", Film, "frames animation"],
      ["aperture", Aperture, "lens photo render"], ["image", Image, "picture reference"], ["frame", Frame, "composition layout"], ["box", Box, "3d cube asset"],
      ["boxes", Boxes, "assets library"], ["cuboid", Cuboid, "3d cinema4d model"], ["shapes", Shapes, "design forms"], ["spline", Spline, "curve motion"],
      ["orbit", Orbit, "unreal space motion"], ["atom", Atom, "simulation houdini fx"], ["layers", Layers, "compositing after effects"],
      ["wand", Wand, "magic fx"], ["sparkles", Sparkles, "polish fx magic"], ["sparkle", Sparkle, "shine"], ["lightbulb", Lightbulb, "idea"],
      ["brain", Brain, "think learn"], ["flask-conical", FlaskConical, "experiment test lab rnd"], ["wrench", Wrench, "fix tools"], ["hammer", Hammer, "build"],
      ["settings", Settings, "gear engine setup"], ["puzzle", Puzzle, "problem solve"], ["ruler", Ruler, "layout measure"], ["scissors", Scissors, "cut edit"],
      ["gamepad-2", Gamepad2, "game gaming unreal"], ["joystick", Joystick, "game"], ["music", Music, "note song"], ["headphones", Headphones, "music audio sound"],
      ["guitar", Guitar, "music"], ["piano", Piano, "keys music"], ["mic", Mic, "record voice podcast"],
    ],
  },
  {
    name: "Learn",
    items: [
      ["book-open", BookOpen, "read study"], ["book", Book, "read"], ["library", Library, "books study"], ["graduation-cap", GraduationCap, "study course learn"],
      ["school", School, "class lesson"], ["microscope", Microscope, "research science"], ["telescope", Telescope, "research explore"], ["globe", Globe, "world language"],
      ["languages", Languages, "language translate"], ["message-circle", MessageCircle, "chat talk discuss"], ["newspaper", Newspaper, "news read"],
      ["search", Search, "research look"], ["map", Map, "explore plan"], ["compass", Compass, "direction explore"], ["calculator", Calculator, "math numbers"],
      ["glasses", Glasses, "read"],
    ],
  },
  {
    name: "Life",
    items: [
      ["footprints", Footprints, "walk steps"], ["dog", Dog, "dog walk pet"], ["paw-print", PawPrint, "pets dogs walk"], ["cat", Cat, "pet"],
      ["dumbbell", Dumbbell, "gym weights"], ["bike", Bike, "cycle ride"], ["activity", Activity, "run exercise cardio"], ["heart-pulse", HeartPulse, "health cardio"],
      ["bed", Bed, "sleep rest"], ["moon", Moon, "night evening sleep"], ["sun", Sun, "day morning"], ["sunrise", Sunrise, "morning early"], ["sunset", Sunset, "evening"],
      ["cooking-pot", CookingPot, "cook dinner kitchen"], ["chef-hat", ChefHat, "cook"], ["salad", Salad, "healthy food"], ["utensils", Utensils, "eat meal lunch dinner"],
      ["apple", Apple, "snack food"], ["coffee", Coffee, "break cafe"], ["cup-soda", CupSoda, "drink"], ["droplet", Droplet, "water hydrate"],
      ["shopping-cart", ShoppingCart, "groceries shopping"], ["shopping-bag", ShoppingBag, "shopping"], ["washing-machine", WashingMachine, "laundry chores"],
      ["shirt", Shirt, "clothes laundry"], ["bath", Bath, "clean shower"], ["armchair", Armchair, "relax rest"], ["sofa", Sofa, "relax home"],
      ["heart", Heart, "love partner date"], ["user", User, "personal me"], ["baby", Baby, "family kids"], ["house", House, "home"], ["car", Car, "drive commute"],
      ["bus", Bus, "commute travel"], ["train-front", TrainFront, "commute travel"], ["plane", Plane, "travel flight"], ["tree-pine", TreePine, "nature outside"],
      ["trees", Trees, "park forest"], ["leaf", Leaf, "nature calm"], ["flower-2", Flower2, "garden"], ["pill", Pill, "medicine health"],
      ["stethoscope", Stethoscope, "doctor health"], ["smile", Smile, "happy mood"],
    ],
  },
  {
    name: "Fun",
    items: [
      ["popcorn", Popcorn, "movie film watch cinema"], ["tv", Tv, "show series watch"], ["dice-5", Dice5, "board game"], ["drama", Drama, "theatre culture"],
      ["radio", Radio, "listen"], ["podcast", Podcast, "listen"], ["smartphone", Smartphone, "phone social scroll"], ["party-popper", PartyPopper, "party celebrate"],
      ["beer", Beer, "drinks friends pub"], ["wine", Wine, "drinks dinner"], ["gift", Gift, "present"], ["ticket", Ticket, "concert event gig"],
    ],
  },
  {
    name: "Symbols",
    items: [
      ["star", Star, "favourite"], ["flame", Flame, "fire hot urgent"], ["zap", Zap, "energy fast lightning"], ["rocket", Rocket, "launch ship"],
      ["gem", Gem, "premium"], ["trophy", Trophy, "win award"], ["medal", Medal, "achievement"], ["crown", Crown, "best"], ["flag", Flag, "milestone"],
      ["lock", Lock, "private"], ["triangle-alert", TriangleAlert, "warning"], ["circle-alert", CircleAlert, "important"], ["circle-help", CircleHelp, "question"],
      ["hourglass", Hourglass, "wait time"], ["infinity", Infinity, "loop endless"], ["ghost", Ghost, "spooky"], ["skull", Skull, "dark"], ["anchor", Anchor, "stable"],
      ["mountain", Mountain, "challenge climb"], ["waves", Waves, "flow calm sea"], ["snowflake", Snowflake, "winter cold"], ["umbrella", Umbrella, "rain"],
      ["cloud-rain", CloudRain, "rain weather"], ["bird", Bird, "free"], ["fish", Fish, "sea"],
    ],
  },
];

const BY_NAME: Record<string, LucideIcon> = Object.fromEntries(ICON_GROUPS.flatMap((g) => g.items.map(([n, I]) => [n, I])));
export const ICON_NAMES = Object.keys(BY_NAME);
export const iconExists = (name: string | null | undefined) => !!name && name in BY_NAME;

/** A Lucide icon by its stored name; nothing for an unknown or empty name. */
export function Icon({ name, size = 14, className, strokeWidth }: { name: string | null | undefined; size?: number; className?: string; strokeWidth?: number }) {
  const I = name ? BY_NAME[name] : undefined;
  return I ? <I size={size} className={className} strokeWidth={strokeWidth ?? 1.9} aria-hidden /> : null;
}

/** Search the set by name or keyword (prefix match on each word). */
export function searchIcons(q: string): Entry[] {
  const term = q.trim().toLowerCase();
  if (!term) return ICON_GROUPS.flatMap((g) => g.items);
  return ICON_GROUPS.flatMap((g) => g.items).filter(([n, , k]) => n.includes(term) || k.split(" ").some((w) => w.startsWith(term)));
}
