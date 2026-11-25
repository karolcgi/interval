import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "./styles/tokens.css";
import "./styles/app.css";
import { App } from "./ui/App";
import { boot } from "./bootstrap";

// The floating mini timer and the completion popup are tiny windows of their own: they render the
// main window's timer and never open the database.
const kind = new URLSearchParams(location.search).get("window");
const root = createRoot(document.getElementById("root")!);

if (kind === "mini" || kind === "popup") {
  document.documentElement.dataset.window = kind;
  void import("./ui/FloatWindows").then(({ MiniTimerApp, PopupApp }) =>
    root.render(<StrictMode>{kind === "mini" ? <MiniTimerApp /> : <PopupApp />}</StrictMode>),
  );
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  void boot();
  void import("./sound").then((m) => m.unlockAudio());
}
