import { ReactNativeSafeAreaContext } from "@valenced/externals/react-native-safe-area-context";
import { Image, Pressable, View } from "react-native";
import { getAssetIdByName } from "@valenced/assets";
import { createElement as h, isValidElement } from "react";
import type { ComponentProps, ReactNode } from "react";
import { Design, FormSwitch } from "@valenced/discord/design";

export function NativeSection({ title, footer, children }: { title?: string; footer?: string; children?: ReactNode }) {
  return h(Design.TableRowGroup, { title, description: footer, children });
}

type NativeRowProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  subtitleLines?: number;
  trailing?: ReactNode;
  icon?: string;
  noIcon?: boolean;
  onPress?: () => void;
};

export function NativeRow({ title, subtitle, subtitleLines = 5, trailing, icon, noIcon, onPress }: NativeRowProps) {
  const label = { label: title, subLabel: subtitle, subLabelLineClamp: subtitleLines, icon: noIcon ? undefined : rowIcon(icon) };
  if (isValidElement<ComponentProps<typeof NativeSwitch>>(trailing) && trailing.type === NativeSwitch) {
    return h(Design.TableSwitchRow, {
      ...label,
      value: !!trailing.props.value,
      onValueChange: trailing.props.onChange,
    });
  }
  return h(Design.TableRow, { ...label, trailing, onPress, arrow: !!onPress && !trailing });
}

export function NativeSwitch({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) {
  return h(FormSwitch, { value: !!value, onValueChange: onChange });
}

export function NativeAction({ title, onPress, compact, secondary, danger, disabled, top, icon }: {
  title: string;
  onPress: () => void;
  compact?: boolean;
  secondary?: boolean;
  danger?: boolean;
  disabled?: boolean;
  top?: number;
  icon?: string;
}) {
  return h(Design.Button, {
    text: title,
    icon: assetIcon(icon),
    onPress,
    size: compact ? "sm" : "md",
    variant: danger ? "destructive" : secondary ? "secondary" : "primary",
    disabled,
    style: { marginTop: top ?? 8 },
  });
}

type NativeInputProps = Omit<ComponentProps<typeof Design.TextInput>, "onChange"> & {
  onChangeText: (value: string) => void;
};
export function NativeInput({ onChangeText, ...props }: NativeInputProps) {
  return h(Design.TextInput, { ...props, onChange: onChangeText });
}

export const settingsContent = {
  padding: 16,
  paddingBottom: 32,
  gap: 20,
};

const assets: Record<string, string> = {
  at: "AtIcon",
  bell: "BellIcon",
  chat: "ChatMarkUnreadIcon",
  edit: "PencilIcon",
  gear: "SettingsIcon",
  guide: "ClipboardCheckIcon",
  key: "KeyIcon",
  lang: "LanguageIcon",
  link: "LinkIcon",
  lock: "LockIcon",
  mic: "MicrophoneIcon",
  paint: "PaintPaletteIcon",
  plus: "PlusSmallIcon",
  power: "SettingsIcon",
  reply: "ChatMarkUnreadIcon",
  search: "CompassIcon",
  server: "PinIcon",
  shield: "ShieldIcon",
  star: "StarIcon",
  store: "ClipboardListIcon",
  test: "WrenchIcon",
  text: "PencilIcon",
  time: "ClockIcon",
  trash: "TrashIcon",
  "↗": "LanguageIcon",
  "↙": "LanguageIcon",
  "★": "StarIcon",
  "☷": "ChatMarkUnreadIcon",
  "◷": "ClockIcon",
};

function assetIcon(icon?: string) {
  return icon ? getAssetIdByName(assets[icon] ?? icon) : undefined;
}

export function rowIcon(icon?: string) {
  const source = assetIcon(icon);
  return source ? h(Design.TableRow.Icon, { source }) : undefined;
}

export function NativeGuide({ title, steps }: {
  title: string;
  steps: readonly (readonly [string, string])[];
}) {
  return h(NativeSection, {
    title,
    children: steps.map(([label, subLabel]) =>
      h(Design.TableRow, { key: label, label, subLabel, subLabelLineClamp: 12 }),
    ),
  });
}

export function useSheetBottomPadding() {
  const { bottom } = ReactNativeSafeAreaContext.useSafeAreaInsets();
  return Math.max(24, bottom + 8);
}

export function NativeIconControl({ icon, iconColor, fallback, label, holdLabel, onPress, onLongPress, variant, disabled }: {
  icon?: number;
  iconColor?: string;
  fallback?: string;
  label: string;
  holdLabel: string;
  onPress: () => void;
  onLongPress: () => void;
  variant: ComponentProps<typeof Design.IconButton>["variant"];
  disabled?: boolean;
}) {
  // Discord's IconButton label renders as a caption. Keep the icon visual and let
  // the native touch target own both gestures and the screen-reader label.
  return h(Pressable, {
    accessibilityRole: "button",
    accessibilityLabel: label,
    accessibilityState: { disabled },
    accessibilityActions: [{ name: "longpress", label: holdLabel }],
    onAccessibilityAction: (event) => {
      if (!disabled && event.nativeEvent.actionName === "longpress") onLongPress();
    },
    disabled,
    onPress,
    onLongPress,
    style: { opacity: disabled ? 0.5 : 1, flexShrink: 0, alignSelf: "center", ...(iconColor ? { width: 32, height: 36, alignItems: "center", justifyContent: "center" } : null) },
  }, h(View, {
    pointerEvents: "none",
    accessibilityElementsHidden: true,
    importantForAccessibility: "no-hide-descendants",
  }, icon
    ? iconColor
      ? h(Image, { source: icon, resizeMode: "contain", style: { width: 18, height: 18, tintColor: iconColor } })
      : h(Design.IconButton, { icon, variant, size: "sm" })
    : h(Design.Text, {
        variant: "text-lg/semibold",
        style: { width: 36, height: 36, textAlign: "center", textAlignVertical: "center" },
      }, fallback)));
}
