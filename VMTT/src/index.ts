import implementation, { useSettings } from "./plugin.js";
import { clearCache } from "./valenced";
export default plugin<{ jsonStorage: Record<string, any> }>({
  jsonStorage: { load: true, default: useSettings.defaults },
  async start({ jsonStorage, cleanup, plugin: instance }) {
    const data = await jsonStorage.get();
    useSettings.attach(data, jsonStorage, (error) =>
      instance.reportError(error),
    );
    cleanup(async () => {
      implementation.onUnload();
      clearCache();
      await useSettings.detach();
    });
    implementation.onLoad();
    if (instance.startedLate) instance.requireReload();
  },
  stop({ plugin: instance }) {
    instance.requireReload();
  },
  SettingsComponent: implementation.settings,
});
