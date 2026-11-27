// Opens a vault note in Obsidian via an obsidian:// link (v0.11; own module since v0.12 so the timer engine can use it).
import { store } from "../state/store";
import * as A from "../state/actions";
import { openExternal } from "../platform";
import { obsidianUri, vaultNameOf } from "../domain/integration";

export function openInObsidian(path: string) {
  const vault = vaultNameOf(store.get().settings.integration);
  if (!vault) return A.toast("Set the vault in Settings › Obsidian first");
  void openExternal(obsidianUri(vault, path)).catch(A.reportError);
}
