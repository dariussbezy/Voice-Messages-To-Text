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
export function CompactSheet({
  children,
  initialHeight = 300,
  maxRatio = 0.65,
}: {
  children?: React.ReactNode;
  initialHeight?: number;
  maxRatio?: number;
}) {
  const cap = Math.round(RN.Dimensions.get("window").height * maxRatio);
  const [height, setHeight] = React.useState(Math.min(initialHeight, cap));
  const Sheet = Design.ActionSheet as unknown as React.ComponentType<any>;
  const Scroll =
    findByProps("BottomSheetScrollView")?.BottomSheetScrollView ||
    RN.ScrollView;
  return React.createElement(
    Sheet,
    {
      scrollable: true,
      startExpanded: false,
      startHeight: height + 32,
      contentHeight: height,
      maxHeight: cap + 32,
    },
    React.createElement(
      Scroll,
      {
        style: { height, flexGrow: 0 },
        contentContainerStyle: { paddingBottom: 8 },
        onContentSizeChange: (_width: number, measured: number) => {
          if (measured > 0) setHeight(Math.min(Math.ceil(measured), cap));
        },
        keyboardShouldPersistTaps: "handled",
        nestedScrollEnabled: true,
        showsVerticalScrollIndicator: true,
      },
      children,
    ),
  );
}
let pickKey: string | undefined;
function showSimpleActionSheet(config: any) {
  pickKey = config.key;
  const light = findByStoreName("ThemeStore")?.theme === "light";
  const text = light ? "#060607" : "#FFFFFF";
  const card = light ? "#F2F3F5" : "#2B2D31";
  const divider = light ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.08)";
  const Component = () =>
    React.createElement(
      CompactSheet,
      { initialHeight: 64 + config.options.length * 56 },
      React.createElement(
        RN.View,
        { style: { paddingHorizontal: 16, paddingBottom: 8 } },
        React.createElement(
          RN.Text,
          {
            style: {
              textAlign: "center",
              paddingTop: 4,
              paddingBottom: 20,
              fontSize: 18,
              fontWeight: "700",
              color: text,
            },
          },
          config.header.title,
        ),
        React.createElement(
          RN.View,
          {
            style: {
              borderRadius: 18,
              overflow: "hidden",
              backgroundColor: card,
            },
          },
          ...config.options.map((option: any, index: number) =>
            React.createElement(
              RN.Pressable,
              {
                key: index,
                onPress: option.onPress,
                accessibilityRole: "radio",
                accessibilityState: { selected: !!option.selected },
                style: ({ pressed }: { pressed: boolean }) => ({
                  minHeight: 56,
                  paddingHorizontal: 16,
                  paddingVertical: 16,
                  flexDirection: "row" as const,
                  alignItems: "center" as const,
                  backgroundColor: pressed ? divider : "transparent",
                }),
              },
              React.createElement(
                RN.Text,
                { style: { flex: 1, fontSize: 16, color: text } },
                option.label,
              ),
              option.selected
                ? React.createElement(
                    RN.Text,
                    {
                      style: {
                        color: "#5865F2",
                        fontSize: 18,
                        fontWeight: "700",
                      },
                    },
                    "✓",
                  )
                : null,
              index < config.options.length - 1
                ? React.createElement(RN.View, {
                    style: {
                      position: "absolute",
                      bottom: 0,
                      left: 16,
                      right: 16,
                      height: 1,
                      backgroundColor: divider,
                    },
                  })
                : null,
            ),
          ),
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
