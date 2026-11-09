import * as React from "react";
import * as RN from "react-native";
type AnyModule = Record<string, any>;
import { lookupModule, getModules } from "@valenced/modules/finders";
import { withProps, withName } from "@valenced/modules/finders/filters";
import { instead as nativeInstead } from "@valenced/patcher";
import { Stores } from "@valenced/discord/flux";
import { Design } from "@valenced/discord/design";
import {
  ActionSheetActionCreators,
  ToastActionCreators,
} from "@valenced/discord/actions";
import { getAssetIdByName } from "@valenced/assets";
type Fn = (...args: any[]) => any;
type Module = Record<string, any>;
const cache = new Map<string, Module>();
let sequence = 0;
export const findAssetId = getAssetIdByName;
export const findByStoreName = (name: string) =>
  (Stores as unknown as Module)[name];
export function showToast(text: string) {
  ToastActionCreators.open(`dariuss.voice-messages-to-text.${++sequence}`, {
    text,
  });
}
export function findByProps(...props: string[]): Module | undefined {
  if (props.includes("showSimpleActionSheet")) return { showSimpleActionSheet };
  if (props.includes("openLazy")) return ActionSheetActionCreators;
  if (props.some((p) => ["ActionSheet", "ActionSheetCloseButton"].includes(p)))
    return Design;
  const key = props.join("|");
  if (cache.has(key)) return cache.get(key);
  const [value] = lookupModule(withProps(...(props as [string, ...string[]])));
  if (value) cache.set(key, value as Module);
  return value as Module | undefined;
}
export const patcher = {
  instead(
    key: string,
    target: Module,
    hook: (args: any[], original: Fn) => any,
  ) {
    return nativeInstead(
      target as Record<string, Fn>,
      key,
      function (args, original) {
        return hook(args, (...next) => Reflect.apply(original, this, next));
      },
    );
  },
  after(key: string, target: Module, hook: (args: any[], result: any) => any) {
    return nativeInstead(
      target as Record<string, Fn>,
      key,
      function (args, original) {
        const result = Reflect.apply(original, this, args);
        return hook(args, result) ?? result;
      },
    );
  },
};
export function observeProps(
  props: [string, ...string[]],
  callback: (module: Module) => void,
) {
  let active = true;
  const remove = getModules(withProps(...props), (value) => {
    if (active) callback(value as Module);
  });
  return () => {
    active = false;
    remove();
  };
}

export function observeName(name: string, callback: (module: any) => void) {
  let active = true;
  const remove = getModules(withName(name), (value) => {
    if (active) callback(value);
  });
  return () => {
    active = false;
    remove();
  };
}
export function SheetScroll({ children }: { children?: React.ReactNode }) {
  // Resolve inside the sheet provider, including when the module loaded lazily.
  const Scroll =
    findByProps("BottomSheetScrollView")?.BottomSheetScrollView ||
    RN.ScrollView;
  return React.createElement(
    Scroll,
    {
      style: { height: Math.round(RN.Dimensions.get("window").height * 0.7) },
      contentContainerStyle: { paddingBottom: 24 },
      nestedScrollEnabled: true,
      keyboardShouldPersistTaps: "handled",
      showsVerticalScrollIndicator: true,
    },
    children,
  );
}
let pickKey: string | undefined;
function showSimpleActionSheet(config: any) {
  pickKey = config.key;
  const Sheet = Design.ActionSheet as unknown as React.ComponentType<any>;
  const Row = Design.ActionSheetRow as unknown as React.ComponentType<any>;
  const Component = () =>
    React.createElement(
      Sheet,
      { scrollable: true, startExpanded: true },
      React.createElement(
        SheetScroll,
        null,
        React.createElement(
          RN.Text,
          {
            style: {
              padding: 16,
              fontSize: 20,
              fontWeight: "700",
              color:
                findByStoreName("ThemeStore")?.theme === "light"
                  ? "#060607"
                  : "#fff",
            },
          },
          config.header.title,
        ),
        ...config.options.map((option: any, index: number) =>
          React.createElement(Row, {
            key: index,
            label: option.label,
            onPress: option.onPress,
          }),
        ),
      ),
    );
  ActionSheetActionCreators.openLazy(
    Promise.resolve({ default: Component }),
    config.key,
    {},
  );
}
export function clearCache() {
  cache.clear();
  if (pickKey) ActionSheetActionCreators.hideActionSheet(pickKey);
  pickKey = undefined;
}
export function injectMessageActions(
  tree: any,
  plan: { key: string; label: string; press: () => void }[],
  dismiss: () => void,
): any {
  let inserted = false;
  const visit = (node: any, depth = 0): any => {
    if (depth > 40 || !node) return node;
    if (Array.isArray(node)) {
      const template = node.find(
        (child) =>
          React.isValidElement<AnyModule>(child) &&
          typeof child.props.onPress === "function" &&
          typeof child.props.label === "string",
      );
      if (
        template &&
        !inserted &&
        !node.some((child) => String(child?.key ?? "").startsWith("vt-"))
      ) {
        inserted = true;
        const tint =
          findByStoreName("ThemeStore")?.theme === "light"
            ? "#060607"
            : "#FFFFFF";
        const icon = React.isValidElement<AnyModule>(template.props.icon)
          ? React.cloneElement(template.props.icon, {
              IconComponent: () =>
                React.createElement(RN.Image, {
                  resizeMode: "cover",
                  style: { width: 24, height: 24, tintColor: tint },
                  source: findAssetId("MicrophoneIcon"),
                }),
            })
          : undefined;
        const rows = plan
          .filter((item) => !node.some((child) => child?.key === item.key))
          .map((item) =>
            React.cloneElement(template as React.ReactElement<AnyModule>, {
              key: item.key,
              label: item.label,
              icon,
              onPress: () => {
                dismiss();
                item.press();
              },
            }),
          );
        const copy = node.findIndex((child) =>
          String(child?.props?.label ?? child?.props?.message ?? "")
            .toUpperCase()
            .includes("COPY"),
        );
        const index = copy < 0 ? node.length : copy;
        return [...node.slice(0, index), ...rows, ...node.slice(index)];
      }
      return node.map((child) => visit(child, depth + 1));
    }
    if (React.isValidElement<AnyModule>(node) && node.props.children) {
      const child = node.props.children;
      const singleRow =
        React.isValidElement<AnyModule>(child) &&
        typeof child.props.onPress === "function" &&
        typeof child.props.label === "string";
      return React.cloneElement(
        node,
        {},
        visit(singleRow ? [child] : child, depth + 1),
      );
    }
    return node;
  };
  return visit(tree);
}
