import type { ComponentType } from "react";
import type { createPluginStore } from "./settings-store";
export const useSettings: ReturnType<typeof createPluginStore>["useStore"];
declare const implementation: {
  onLoad(): void;
  onUnload(): void;
  settings: ComponentType;
};
export default implementation;
