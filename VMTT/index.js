const rainRuntime = globalThis.rain;
// Free server (no API key for users): deploy worker.js on Cloudflare once, then put its address here.
// DEFAULT_TOKEN must match the TOKEN variable of the worker (leave both empty for an open worker).
const DEFAULT_SERVER = "https://small-bread-a3d3.dariussbezy.workers.dev";
const DEFAULT_TOKEN = "";
if (!rainRuntime || !rainRuntime.api || !rainRuntime.api.storage) throw new Error("Discord plugin API unavailable");
const rainStore = rainRuntime.api.storage.createPluginStore("voicetotext", {
  provider: DEFAULT_SERVER ? "server" : "groq",
  apiKey: "",
  serverUrl: "",
  model: "whisper-large-v3-turbo",
  language: "auto",
  inline: true,
  position: "above",
  textStyle: "link",
  card: false,
  auto: "off",
  saveTranscripts: true,
  transcripts: [],
});
const implementation = (() => {
  "use strict";
  const { metro } = rainRuntime;
  const patcher = rainRuntime.api.patcher;
  const ui = rainRuntime.api.ui;
  const { findByName, findByProps, findByStoreName } = metro;
  const { React, ReactNative: RN, FluxDispatcher, clipboard } = metro.common;
  const common = metro.common || {};
  const stores = common.stores || {};

  const BUILD = "v1.1.18";
  const SHEET_KEY = "voice-transcript";
  const VOICE_MESSAGE_COMPONENT_PATH = "modules/voice_messages/native/components/VoiceMessageChat.tsx";
  const FLAG_VOICE = 8192;
  const FLAG_TOGGLE = 0x04000000;
  const ACCENT = "#8EA1FF";
  const MAX_TRANSCRIPTS = 200;
  const TIMEOUT = 90000;
  const PROVIDERS = {
    server: { name: "Free server (no key)", base: "", byUrl: true, server: true, models: [["whisper-large-v3-turbo", "Whisper large v3 turbo"]] },
    groq: { name: "Groq", base: "https://api.groq.com/openai/v1", byUrl: true,
      models: [["whisper-large-v3-turbo", "Whisper large v3 turbo (fast)"], ["whisper-large-v3", "Whisper large v3 (accurate)"]] },
  };
  const LANGS = [["auto", "Auto-detect"], ["en", "English"], ["ro", "Romanian"], ["es", "Spanish"], ["fr", "French"], ["de", "German"], ["it", "Italian"],
    ["pt", "Portuguese"], ["ru", "Russian"], ["uk", "Ukrainian"], ["pl", "Polish"], ["nl", "Dutch"], ["tr", "Turkish"], ["ar", "Arabic"], ["he", "Hebrew"],
    ["hi", "Hindi"], ["ja", "Japanese"], ["ko", "Korean"], ["zh", "Chinese"], ["cs", "Czech"], ["sv", "Swedish"], ["hu", "Hungarian"], ["el", "Greek"],
    ["bg", "Bulgarian"], ["id", "Indonesian"], ["vi", "Vietnamese"], ["th", "Thai"]];
  const TEXT_STYLES = [["link", "1. Link (colored)"], ["code", "2. Code block"], ["plain", "3. Plain"], ["title", "4. Title"], ["titlelink", "5. Title as link"], ["field", "6. Field"], ["footer", "7. Footer"], ["author", "8. Author"]];
  const AUTO_MODES = [["off", "Off"], ["dms", "Direct messages only"], ["all", "All chats"]];

  const unpatches = [];
  const timers = [];
  const transcripts = new Map();
  const voiceAttachmentOwners = new Map();
  const voiceAttachmentObjectOwners = new WeakMap();
  const busy = new Set();
  let ThemeStore;
  let partsCache = null;
  let loadRequested = false;
  let initialized = false;
  let hydrationUnsubscribe = null;
  let renderUnpatch = null;
  let voiceComponentUnpatch = null;
  let renderErrors = 0;
  let sheetState = { id: null };

  const cfg = () => rainStore.useStore.getState();
  const setSetting = (key, value) => rainStore.useStore.getState().updateSettings({ [key]: value });
  const toast = (t) => { try { ui.toasts.showToast(t); } catch (_) {} };
  const safe = (fn, fallback) => { try { return fn(); } catch (_) { return fallback; } };
  const provider = () => PROVIDERS[cfg().provider] || (DEFAULT_SERVER ? PROVIDERS.server : PROVIDERS.groq);
  const serverEndpoint = () => String(cfg().serverUrl || "").trim() || DEFAULT_SERVER;
  const configured = () => (provider().server ? !!serverEndpoint() : !!String(cfg().apiKey || "").trim());
  const nameOf = (list, code) => { const hit = list.find((x) => x[0] === code); return hit ? hit[1] : String(code); };
  const MessageStore = () => stores.MessageStore || safe(() => findByStoreName("MessageStore"), null);
  const ChannelStore = () => stores.ChannelStore || safe(() => findByStoreName("ChannelStore"), null);
  const UserStore = () => stores.UserStore || safe(() => findByStoreName("UserStore"), null);
  const getMessage = (c, id) => safe(() => MessageStore().getMessage(c, id) || null, null);
  const getChannel = (id) => safe(() => (id ? ChannelStore().getChannel(id) : null), null);
  const isDM = (ch) => !!ch && (ch.type === 1 || ch.type === 3);
  const myId = () => safe(() => String(UserStore().getCurrentUser().id), "");

  /* ---- shared settings design kit (same as the other plugins) ---- */
  function palette() {
    let light = false;
    try { ThemeStore = ThemeStore || findByStoreName("ThemeStore"); light = !!ThemeStore && ThemeStore.theme === "light"; } catch (_) {}
    return light
      ? { text: "#060607", sub: "#5C5E66", bg: "#FFFFFF", card: "#F2F3F5", acc: "#5865F2", accPressed: "#4752C4", blurple: "#5865F2", card2: "rgba(0,0,0,0.045)", chip: "rgba(0,0,0,0.07)", press: "rgba(0,0,0,0.06)", divider: "rgba(0,0,0,0.09)", off: "#B5BAC1" }
      : { text: "#FFFFFF", sub: "#B5BAC1", bg: "#1E1F22", card: "#2B2D31", acc: "#5865F2", accPressed: "#4752C4", blurple: "#5865F2", card2: "rgba(255,255,255,0.06)", chip: "rgba(255,255,255,0.10)", press: "rgba(255,255,255,0.07)", divider: "rgba(255,255,255,0.09)", off: "#4E5058" };
}

  /* ---- shared settings design kit (identical in AML / GPL / QT) ---- */
  const KIT_TILES = {
    lang: ["LanguageIcon", "\u6587", "#5865F2"], paint: ["PaintPaletteIcon", "\u25C9", "#EB459E"], time: ["ClockIcon", "\u25F7", "#E58A00"],
    store: ["ClipboardListIcon", "\u25A3", "#3BA55D"], trash: ["TrashIcon", "\u232B", "#ED4245"], edit: ["PencilIcon", "\u270E", "#F07B3E"],
    shield: ["ShieldIcon", "\u2298", "#80848E"], bell: ["BellIcon", "!", "#E58A00"], at: ["BellIcon", "@", "#ED4245"],
    reply: ["ChatMarkUnreadIcon", "\u21A9", "#5865F2"], search: ["CompassIcon", "\u2315", "#1ABC9C"], chat: ["ChatMarkUnreadIcon", "\u25A4", "#5865F2"],
    plus: ["PlusSmallIcon", "+", "#5865F2"], link: ["LinkIcon", "\u2197", "#3498DB"], test: ["WrenchIcon", "\u25B7", "#9B59B6"],
    star: ["StarIcon", "\u2605", "#D99700"], server: ["PinIcon", "\u25C7", "#3498DB"], power: ["SettingsIcon", "\u25CF", "#43B581"],
    text: ["PencilIcon", "Aa", "#F07B3E"], guide: ["ClipboardCheckIcon", "?", "#5865F2"], gear: ["SettingsIcon", "\u2022", "#80848E"],
    lock: ["LockIcon", "\u25C8", "#80848E"],
    mic: ["MicrophoneIcon", "\u25CF", "#5865F2"], key: ["KeyIcon", "\u26BF", "#E58A00"]
  };
  const KIT_RULES = [
    [/^(default|red|orange|gold|green|teal|blue|indigo|purple|pink|gray)$/i, null],
    [/^ghost ping logger$/i, "power"], [/color|appearance/, "paint"], [/notify|alert|toast/, "bell"], [/test/, "test"],
    [/button|position|composer/, "plus"], [/clear|remove/, "trash"],
    [/clock|time|history|retention|keep .* for/, "time"], [/quick|favorite|saved/, "star"],
    [/cache|storage|persist|remember|restart|across/, "store"],
    [/deleted|delete/, "trash"], [/edit/, "edit"], [/ignore/, "shield"], [/mention|everyone|ping/, "at"],
    [/reply|replies/, "reply"], [/filter|search/, "search"], [/jump/, "link"],
    [/translate|translation|google|deepl|language/, "lang"], [/word|term/, "text"], [/server|guild/, "server"],
    [/capture|message|channel|dm/, "chat"], [/enabled|logger/, "power"]
  ];
  const kitAssetCache = new Map();
  function kitAsset(name) {
    const hit = kitAssetCache.get(name);
    if (hit && (hit.id || Date.now() - hit.at < 5000)) return hit.id;
    let id = null;
    try { const r = globalThis.rain; id = (r && r.api && r.api.assets && r.api.assets.findAssetId && r.api.assets.findAssetId(name)) || null; } catch (_) { id = null; }
    kitAssetCache.set(name, { id, at: Date.now() });
    return id;
  }
  function hexA(hex, a) {
    const m = /^#([0-9a-f]{6})$/i.exec(String(hex || ""));
    if (!m) return hex;
    const n = Math.round(a * 255).toString(16);
    return "#" + m[1] + (n.length < 2 ? "0" + n : n);
  }
  function settingIconForTitle(title) {
    const text = String(title || "").toLowerCase();
    const match = KIT_RULES.find(([pattern]) => new RegExp(pattern).test(text));
    return match ? match[1] : null;
  }
  function kitIconKey(p) {
    if (!p || p.noIcon) return null;
    if (p.icon && KIT_TILES[p.icon]) return p.icon;
    return settingIconForTitle(p.title);
  }
  function KitChevron(p) {
    const h = React.createElement, s = p.size || 8, deg = p.dir === "up" ? "225deg" : p.dir === "right" ? "-45deg" : "45deg";
    return h(RN.View, { style: { width: s, height: s, borderRightWidth: 2, borderBottomWidth: 2, borderColor: p.color, borderRadius: 1, transform: [{ rotate: deg }], marginTop: p.dir === "up" ? 3 : p.dir === "down" ? -3 : 0, marginHorizontal: 3 } });
  }
  function KitTile(p) {
    const h = React.createElement, t = KIT_TILES[p.k] || KIT_TILES.gear, size = p.size || 32, asset = kitAsset(t[0]);
    const inner = Math.round(size * 0.56);
    return h(RN.View, { style: { width: size, height: size, borderRadius: Math.round(size * 0.3), backgroundColor: t[2], alignItems: "center", justifyContent: "center", marginRight: p.noMargin ? 0 : 13 } },
      asset ? h(RN.Image, { source: asset, resizeMode: "contain", style: { width: inner, height: inner, tintColor: "#FFFFFF" } })
        : h(RN.Text, { style: { color: "#FFFFFF", fontSize: Math.round(size * 0.5), fontWeight: "700" } }, t[1]));
  }
  function CustomSection(p) {
    const C = palette(), h = React.createElement;
    const kids = React.Children.toArray(p.children);
    const any = kids.some((k) => k && k.type === CustomRow && kitIconKey(k.props));
    const isAction = (k) => !!k && k.type === CustomAction;
    if (kids.length && kids.every(isAction)) {
      return h(RN.View, { style: { marginBottom: p.title ? 24 : 12 } },
        p.title ? h(RN.View, { style: { flexDirection: "row", alignItems: "center", marginHorizontal: 6, marginBottom: 10 } },
          h(RN.View, { style: { width: 3, height: 14, borderRadius: 2, backgroundColor: C.blurple, marginRight: 8 } }),
          h(RN.Text, { numberOfLines: 1, style: { color: C.text, fontSize: 15, fontWeight: "700", flexShrink: 1 } }, p.title)) : null,
        ...kids.map((k, i) => React.cloneElement(k, { top: i === 0 ? 0 : 10 })));
    }
    const out = kids.map((k, i) => isAction(k)
      ? h(RN.View, { key: "act-" + i, style: { paddingHorizontal: 12, paddingTop: i === 0 ? 12 : 0, paddingBottom: 12 } }, React.cloneElement(k, { top: 0 }))
      : (k && k.type === CustomRow && any && !k.props.noIcon && !kitIconKey(k.props)) ? React.cloneElement(k, { __fallbackIcon: true }) : k);
    return h(RN.View, { style: { marginBottom: p.compact ? 14 : 24 } },
      p.title ? h(RN.View, { style: { flexDirection: "row", alignItems: "center", marginHorizontal: 6, marginBottom: 10 } },
        h(RN.View, { style: { width: 3, height: 14, borderRadius: 2, backgroundColor: C.blurple, marginRight: 8 } }),
        h(RN.Text, { numberOfLines: 1, style: { color: C.text, fontSize: 15, fontWeight: "700", letterSpacing: 0.1, flexShrink: 1 } }, p.title)) : null,
      h(RN.View, { style: { backgroundColor: C.card, borderRadius: 20, overflow: "hidden", borderWidth: 1, borderColor: C.card2 } }, ...out),
      p.footer ? h(RN.Text, { style: { color: C.sub, fontSize: 12, lineHeight: 17, marginHorizontal: 8, marginTop: 8 } }, p.footer) : null);
  }
  function CustomRow(p) {
    const C = palette(), h = React.createElement;
    const key = p.__fallbackIcon ? (kitIconKey(p) || "gear") : kitIconKey(p);
    const tile = key ? KitTile({ k: key, size: 34 }) : null;
    return h(RN.Pressable, {
      accessibilityRole: p.onPress ? "button" : undefined, onPress: p.onPress, disabled: !p.onPress,
      style: ({ pressed }) => ({ minHeight: 66, paddingHorizontal: 16, paddingVertical: 13, flexDirection: "row", alignItems: "center", backgroundColor: pressed ? C.press : "transparent" })
    },
      tile,
      h(RN.View, { style: { flex: 1, minWidth: 0, paddingRight: 10 } },
        h(RN.Text, { numberOfLines: 2, style: { color: C.text, fontSize: 16, fontWeight: "600", lineHeight: 21 } }, p.title),
        p.subtitle ? h(RN.Text, { numberOfLines: 3, style: { color: C.sub, fontSize: 13, marginTop: 3, lineHeight: 18 } }, p.subtitle) : null),
      p.trailing || null,
      !p.last ? h(RN.View, { style: { position: "absolute", bottom: 0, left: key ? 63 : 16, right: 0, height: 1, backgroundColor: C.card2 } }) : null);
  }
  function CustomSwitch(p) {
    const C = palette(), h = React.createElement, on = !!p.value;
    const pos = React.useRef(new RN.Animated.Value(on ? 1 : 0)).current;
    React.useEffect(() => {
      RN.Animated.spring(pos, { toValue: on ? 1 : 0, speed: 24, bounciness: 5, useNativeDriver: true }).start();
    }, [on]);
    return h(RN.Pressable, { accessibilityRole: "switch", accessibilityState: { checked: on }, onPress: () => p.onChange(!on), hitSlop: 10,
      style: { width: 52, height: 32, borderRadius: 16, padding: 3, justifyContent: "center", backgroundColor: on ? (p.color || C.blurple) : C.off } },
      h(RN.Animated.View, { style: { width: 26, height: 26, borderRadius: 13, backgroundColor: "#FFFFFF", shadowColor: "#000000", shadowOpacity: 0.25, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2, transform: [{ translateX: pos.interpolate({ inputRange: [0, 1], outputRange: [0, 20] }) }] } }));
  }
  function CustomAction(p) {
    const C = palette(), h = React.createElement, RED_ = "#ED4245";
    const sc = React.useRef(new RN.Animated.Value(1)).current;
    const to = (v) => RN.Animated.spring(sc, { toValue: v, speed: 40, bounciness: 0, useNativeDriver: true }).start();
    const bg = p.danger ? (p.secondary ? hexA(RED_, 0.14) : RED_) : (p.secondary ? C.chip : C.blurple);
    const fg = p.danger && p.secondary ? RED_ : (p.secondary ? C.text : "#FFFFFF");
    return h(RN.Pressable, { onPress: p.onPress, disabled: p.disabled, onPressIn: () => to(0.97), onPressOut: () => to(1), accessibilityRole: "button" },
      h(RN.Animated.View, { style: { minHeight: p.compact ? 42 : 50, borderRadius: 15, alignItems: "center", justifyContent: "center", paddingHorizontal: p.compact ? 12 : 18, marginTop: p.top != null ? p.top : 10, backgroundColor: bg, opacity: p.disabled ? 0.45 : 1, transform: [{ scale: sc }] } },
        h(RN.Text, { numberOfLines: 1, style: { color: fg, fontWeight: "700", fontSize: p.compact ? 15 : 16 } }, p.title)));
  }
  function CustomInput(p) {
    const C = palette(), h = React.createElement;
    const [focused, setFocused] = React.useState(false);
    return h(RN.TextInput, {
      ...p, placeholderTextColor: C.sub, underlineColorAndroid: "transparent", textAlignVertical: p.multiline ? "top" : "center",
      onFocus: (e) => { setFocused(true); if (p.onFocus) p.onFocus(e); },
      onBlur: (e) => { setFocused(false); if (p.onBlur) p.onBlur(e); },
      style: [{ minHeight: 50, borderRadius: 14, borderWidth: 1.5, borderColor: focused ? C.blurple : C.card2, backgroundColor: C.bg, color: C.text, paddingHorizontal: 15, fontSize: 16 }, p.style]
    });
  }
  let kitHeroPlayed = false;
  function KitHero(p) {
    const C = palette(), h = React.createElement, accent = p.accent || C.blurple;
    const stats = (p.stats || []).filter(Boolean);
    const enter = React.useRef(new RN.Animated.Value(kitHeroPlayed ? 1 : 0)).current;
    React.useEffect(() => { if (kitHeroPlayed) return; kitHeroPlayed = true; RN.Animated.spring(enter, { toValue: 1, speed: 14, bounciness: 6, useNativeDriver: true }).start(); }, []);
    return h(RN.Animated.View, { style: { borderRadius: 26, backgroundColor: C.card, borderWidth: 1, borderColor: hexA(accent, 0.4), padding: 18, marginBottom: 24, overflow: "hidden", opacity: enter, transform: [{ scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] } },
      h(RN.View, { pointerEvents: "none", style: { position: "absolute", top: -60, right: -50, width: 190, height: 190, borderRadius: 95, backgroundColor: hexA(accent, 0.16) } }),
      h(RN.View, { pointerEvents: "none", style: { position: "absolute", bottom: -70, left: -40, width: 140, height: 140, borderRadius: 70, backgroundColor: hexA(accent, 0.08) } }),
      h(RN.View, { style: { flexDirection: "row", alignItems: "center" } },
        KitTile({ k: p.icon, size: 54, noMargin: true }),
        h(RN.View, { style: { flex: 1, marginLeft: 14 } },
          h(RN.Text, { numberOfLines: 2, style: { color: C.text, fontSize: 21, fontWeight: "800", letterSpacing: -0.2 } }, p.title),
          p.subtitle ? h(RN.Text, { numberOfLines: 2, style: { color: C.sub, fontSize: 14, marginTop: 3, lineHeight: 19 } }, p.subtitle) : null)),
      stats.length ? h(RN.View, { style: { flexDirection: "row", marginTop: 16 } }, ...stats.map((s, i) =>
        h(RN.View, { key: "stat-" + i, style: { flex: 1, borderRadius: 15, backgroundColor: C.chip, paddingVertical: 11, paddingHorizontal: 12, marginRight: i === stats.length - 1 ? 0 : 8 } },
          h(RN.Text, { numberOfLines: 1, adjustsFontSizeToFit: true, style: { color: C.text, fontSize: 19, fontWeight: "800" } }, String(s[1])),
          h(RN.Text, { numberOfLines: 1, style: { color: C.sub, fontSize: 12, marginTop: 2, fontWeight: "600" } }, s[0])))) : null);
  }
  function KitGuide(p) {
    const C = palette(), h = React.createElement;
    const [open, setOpen] = React.useState(true);
    const steps = p.steps || [];
    return h(RN.View, { style: { marginTop: 4, marginBottom: 16, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.card2, overflow: "hidden" } },
      h(RN.Pressable, { onPress: () => setOpen(!open), accessibilityRole: "button", accessibilityState: { expanded: open }, style: ({ pressed }) => ({ flexDirection: "row", alignItems: "center", padding: 16, backgroundColor: pressed ? C.press : "transparent" }) },
        KitTile({ k: "guide", size: 34 }),
        h(RN.View, { style: { flex: 1 } },
          h(RN.Text, { style: { color: C.text, fontSize: 17, fontWeight: "800" } }, p.title || "Quick guide"),
          h(RN.Text, { style: { color: C.sub, fontSize: 13, marginTop: 2 } }, steps.length + " short steps")),
        h(RN.View, { style: { width: 24, alignItems: "center", justifyContent: "center" } }, KitChevron({ dir: open ? "up" : "down", color: C.sub, size: 9 }))),
      open ? h(RN.View, { style: { paddingHorizontal: 16, paddingBottom: 6 } }, ...steps.map((s, i) =>
        h(RN.View, { key: "guide-" + i, style: { flexDirection: "row", paddingTop: 12, paddingBottom: 14, borderTopWidth: 1, borderTopColor: C.card2 } },
          h(RN.View, { style: { width: 26, height: 26, borderRadius: 13, backgroundColor: hexA(C.blurple, 0.2), alignItems: "center", justifyContent: "center", marginRight: 13, marginTop: 1 } },
            h(RN.Text, { style: { color: C.blurple, fontSize: 13, fontWeight: "800" } }, String(i + 1))),
          h(RN.View, { style: { flex: 1 } },
            h(RN.Text, { style: { color: C.text, fontSize: 15, fontWeight: "700", marginBottom: 3 } }, s[0]),
            h(RN.Text, { style: { color: C.sub, fontSize: 14, lineHeight: 20 } }, s[1]))))) : null);
  }
  function KitChip(p) {
    const C = palette(), h = React.createElement;
    return h(RN.Pressable, { onPress: p.onPress, accessibilityRole: "button", accessibilityState: { selected: !!p.active }, hitSlop: 4,
      style: ({ pressed }) => ({ height: 34, borderRadius: 17, paddingHorizontal: 14, marginRight: p.flush ? 0 : 8, marginBottom: p.flush ? 0 : 8, flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: p.active ? C.blurple : C.chip, opacity: pressed ? 0.8 : 1 }) },
      h(RN.Text, { numberOfLines: 1, style: { color: p.active ? "#FFFFFF" : C.text, fontSize: 14, fontWeight: "600" } }, p.label),
      p.badge ? h(RN.View, { style: { marginLeft: 7, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: p.active ? "rgba(255,255,255,0.28)" : hexA(C.blurple, 0.22), alignItems: "center", justifyContent: "center" } },
        h(RN.Text, { style: { color: p.active ? "#FFFFFF" : C.blurple, fontSize: 12, fontWeight: "800" } }, String(p.badge))) : null);
  }



  /* ---- voice message detection ---- */
  const attachmentsOf = (m) => { const a = m && (m.attachments || m.attachment); return Array.isArray(a) ? a : []; };
  const attUrl = (a) => (a && (a.url || a.proxy_url || a.proxyURL || a.proxyUrl)) || null;
  const isAudio = (a) => {
    if (!a) return false;
    const t = String(a.content_type || a.contentType || "").toLowerCase();
    return t.indexOf("audio/") === 0 || /\.(ogg|opus|mp3|m4a|wav)$/i.test(String(a.filename || ""));
  };
  function voiceAttachment(m) {
    if (!m) return null;
    const atts = attachmentsOf(m);
    for (const a of atts) if (a && (a.waveform || a.duration_secs != null || a.durationSecs != null)) return a;
    if (((m.flags | 0) & FLAG_VOICE) === FLAG_VOICE) return atts.find(isAudio) || atts[0] || null;
    return null;
  }
  const durOf = (a) => { const d = a && (a.duration_secs != null ? a.duration_secs : a.durationSecs); return typeof d === "number" ? d : 0; };
  function fmtDur(sec) {
    const s = Math.max(0, Math.round(sec || 0));
    return Math.floor(s / 60) + ":" + (s % 60 < 10 ? "0" : "") + (s % 60);
  }

  /* ---- transcripts (memory + saved) ---- */
  function loadSaved() {
    transcripts.clear();
    const list = cfg().transcripts;
    if (!Array.isArray(list)) return;
    for (const t of list) if (t && t.id && typeof t.text === "string") transcripts.set(String(t.id), t);
  }
  function persist() {
    while (transcripts.size > MAX_TRANSCRIPTS) transcripts.delete(transcripts.keys().next().value);
    if (cfg().saveTranscripts === false) return;
    setSetting("transcripts", Array.from(transcripts.values()));
  }

  /* ---- re-render a message row ---- */
  function refreshRow(channelId, id) {
    const msg = getMessage(channelId, id);
    if (!msg) return;
    const guildId = safe(() => getChannel(channelId).guild_id, null);
    timers.push(setTimeout(() => {
      try {
        FluxDispatcher.dispatch({ type: "MESSAGE_UPDATE", guildId, message: { id, channel_id: channelId, guild_id: guildId, flags: (msg.flags | 0) ^ FLAG_TOGGLE } });
      } catch (_) {}
    }, 0));
  }

  /* ---- transcription service ---- */
  function fetchT(url, opts = undefined) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => { try { controller.abort(); } catch (_) {} }, TIMEOUT) : null;
    return fetch(url, controller ? Object.assign({}, opts, { signal: controller.signal }) : opts).then(
      (res) => { clearTimeout(timer); return res; },
      (err) => { clearTimeout(timer); throw err; });
  }
  const errText = (e) => (e && e.name === "AbortError") ? "The request timed out" : (e && e.message ? e.message : "unknown error");
  async function explain(res) {
    let detail = "";
    try { const j = await res.json(); detail = (j && j.error && (typeof j.error === "string" ? j.error : j.error.message)) || ""; } catch (_) {}
    const s = res.status;
    if (s === 401 || s === 403) return provider().server ? "The server rejected the request (check the token)" : "The API key was rejected";
    if (s === 413) return "This voice message is too large for the service";
    if (s === 429) return "Rate limit reached, try again in a moment";
    if (s >= 500) return "The service is unavailable right now";
    return detail ? String(detail).slice(0, 140) : "The service could not read this audio (" + s + ")";
  }
  async function callService(att) {
    const p = provider(), s = cfg();
    const url = attUrl(att);
    if (!url) throw new Error("This message has no audio file");
    if (p.server) {
      const endpoint = serverEndpoint();
      if (!endpoint) throw new Error("Set the server address in the plugin settings first");
      const payload = { url, language: s.language && s.language !== "auto" ? s.language : undefined };
      const headers = { "Content-Type": "application/json" };
      if (DEFAULT_TOKEN) headers["x-token"] = DEFAULT_TOKEN;
      const r = await fetchT(endpoint, { method: "POST", headers, body: JSON.stringify(payload) });
      if (!r.ok) throw new Error(await explain(r));
      const d = await r.json();
      const t = String(d && d.text != null ? d.text : "").trim();
      if (!t) throw new Error("No speech was found in this voice message");
      return t;
    }
    const key = String(s.apiKey || "").trim();
    if (!key) throw new Error("Add your API key in the plugin settings first");
    const model = p.models.some((x) => x[0] === s.model) ? s.model : p.models[0][0];
    const form = new FormData();
    form.append("model", model);
    form.append("response_format", "json");
    if (s.language && s.language !== "auto") form.append("language", s.language);
    if (p.byUrl) form.append("url", url);
    else {
      const file = await fetchT(url);
      if (!file.ok) throw new Error("Could not download the voice message");
      const blob = await file.blob();
      try { Object.assign(blob, { name: "voice-message.ogg" }); } catch (_) {}
      form.append("file", blob);
    }
    const res = await fetchT(p.base + "/audio/transcriptions", { method: "POST", headers: { Authorization: "Bearer " + key }, body: form });
    if (!res.ok) throw new Error(await explain(res));
    const data = await res.json();
    const text = String(data && data.text != null ? data.text : "").trim();
    if (!text) throw new Error("No speech was found in this voice message");
    return text;
  }
  async function testConnection() {
    const key = String(cfg().apiKey || "").trim();
    const srv = provider().server;
    if (srv ? !serverEndpoint() : !key) { toast(srv ? "Set the server address first" : "Paste your API key first"); return; }
    try {
      const res = srv ? await fetchT(serverEndpoint()) : await fetchT(provider().base + "/models", { headers: { Authorization: "Bearer " + key } });
      toast(res.ok ? "Connection works" : await explain(res));
    } catch (e) { toast(errText(e)); }
  }

  /* ---- main action ---- */
  function sheetParts() {
    if (partsCache && partsCache.ActionSheet) return partsCache;
    let ActionSheet = null, Close = null;
    try { const a = findByProps("ActionSheet"); ActionSheet = a && a.ActionSheet || null; } catch (_) {}
    try { const c = findByProps("ActionSheetCloseButton"); Close = c && c.ActionSheetCloseButton || null; } catch (_) {}
    partsCache = { ActionSheet, Close };
    return partsCache;
  }
  const lazySheets = () => safe(() => findByProps("openLazy", "hideActionSheet"), null);
  function closeSheet() { try { const s = lazySheets(); s && s.hideActionSheet && s.hideActionSheet(SHEET_KEY); } catch (_) {} }
  function openResult(id) {
    sheetState = { id: String(id) };
    try {
      const s = lazySheets();
      if (s && typeof s.openLazy === "function" && sheetParts().ActionSheet) { s.openLazy(Promise.resolve({ default: ResultSheet }), SHEET_KEY, {}); return true; }
    } catch (_) {}
    return false;
  }
  async function transcribeMessage(message, opts = undefined) {
    const o = opts || {};
    const id = message && message.id ? String(message.id) : "";
    const att = voiceAttachment(message);
    if (!id || !att) { if (!o.auto) toast("This is not a voice message"); return; }
    if (transcripts.has(id)) { if (!o.auto) openResult(id); return; }
    if (busy.has(id)) { if (!o.auto) toast("Already transcribing this message"); return; }
    busy.add(id);
    if (!o.auto) toast("Transcribing…");
    const channelId = String(message.channel_id || message.channelId || "");
    try {
      const text = await callService(att);
      transcripts.set(id, { id, channelId, text, at: Date.now(), dur: durOf(att), by: provider().name });
      persist();
      refreshRow(channelId, id);
      if (!o.auto) {
        const inlineWorks = cfg().inline !== false && !!renderUnpatch;
        if (cfg().card === true || !inlineWorks) { if (!openResult(id)) toast(text.slice(0, 120)); }
      }
    } catch (e) {
      if (!o.auto || configured()) toast("Transcription failed: " + errText(e));
    } finally { busy.delete(id); }
  }
  function removeTranscript(id) {
    const t = transcripts.get(id);
    transcripts.delete(id);
    persist();
    if (t) refreshRow(t.channelId, id);
  }
  function copyText(text) {
    try { clipboard.setString(text); toast("Copied"); } catch (_) { toast("Could not copy"); }
  }

  /* ---- inline text on the voice message ---- */
  function paint(nodes, color) {
    if (!color) return nodes;
    return [{ type: "link", target: "usernameOnClick", context: { username: "", usernameOnClick: { action: "0", userId: "0", linkColor: color, messageChannelId: "0" } }, content: nodes }];
  }
  function stripOurs(nodes) {
    const out = [];
    for (const n of nodes) {
      if (n && n.__vt) continue;
      if (n && Array.isArray(n.content)) {
        const inner = stripOurs(n.content);
        if (!inner.length && n.content.length) continue;
        out.push(inner.length === n.content.length ? n : Object.assign({}, n, { content: inner }));
      } else out.push(n);
    }
    return out;
  }
  function decorate(row, input) {
    const m = row && row.message;
    if (!m) return;
    const rowType = input && input.rowType !== undefined ? input.rowType : row.rowType;
    rememberVoiceAttachmentOwner(m);
    const found = cfg().inline === false ? null : transcripts.get(String(m.id));
    if (rowType !== 1 && !found) return;
    const tr = found;
    const below = cfg().position === "below";
    // remove any embed added earlier (it is added again below when needed)
    const embeds = Array.isArray(m.embeds) ? m.embeds : [];
    const cleanEmbeds = embeds.filter((e) => !(e && e.__vt));
    if (cleanEmbeds.length !== embeds.length) m.embeds = cleanEmbeds;
    const ours = !!m.__vtOut && m.content === m.__vtOut;
    if (!tr || below) {
      if (ours) m.content = m.__vtBase;
      else if (Array.isArray(m.content)) { const clean = stripOurs(m.content); if (clean.length !== m.content.length) m.content = clean; }
      delete m.__vtOut;
      delete m.__vtBase;
      if (!tr) return;
      // BELOW is rendered as a native Text sibling of the player, never as an embed.
      // The native embed decoder expects a different shape and can render its text black.
      return;
    }
    // ABOVE: the text goes in the message content, coloured with the accent colour
    const base = ours ? m.__vtBase : Array.isArray(m.content) ? stripOurs(m.content) : (m.content == null || (typeof m.content === "string" && !m.content.trim()) ? [] : null);
    if (!Array.isArray(base)) return;
    const pc = RN.processColor;
    const color = pc ? pc(ACCENT) : null;
    const text = [{ type: "text", content: tr.text, __vt: true }];
    const gap = () => ({ type: "text", content: "\n", __vt: true });
    const out = base.length ? base.concat([gap(), gap()], paint(text, color)) : paint(text, color);
    m.__vtBase = base;
    m.__vtOut = out;
    m.content = out;
  }
  function onRenderError() {
    renderErrors++;
    if (renderErrors >= 3 && renderUnpatch) {
      try { renderUnpatch(); } catch (_) {}
      renderUnpatch = null;
      toast("Voice Messages to Text: text on voice messages was turned off after repeated errors");
    }
  }
  function patchRender() {
    const RowManager = safe(() => findByName("RowManager"), null);
    if (!RowManager || !RowManager.prototype || typeof RowManager.prototype.generate !== "function") return false;
    renderUnpatch = rainRuntime.api.patcher.after("generate", RowManager.prototype, (args, ret) => {
      try { decorate(ret, args[0]); } catch (_) { onRenderError(); }
    });
    return true;
  }

  function rememberVoiceAttachmentOwner(message) {
    const attachment = voiceAttachment(message);
    if (!attachment || !message || !message.id) return;
    const messageId = String(message.id);
    voiceAttachmentObjectOwners.set(attachment, messageId);
    for (const key of ["id", "url", "proxy_url", "proxyUrl", "proxyURL", "src", "uri", "attachment_id", "attachmentId"]) {
      const value = attachment[key];
      if (value != null && String(value)) voiceAttachmentOwners.set(String(value), messageId);
    }
  }
  function transcriptForIdentifier(value) {
    if (value == null) return null;
    const key = String(value);
    const direct = transcripts.get(key);
    if (direct) return direct;
    const ownerId = voiceAttachmentOwners.get(key);
    return ownerId ? transcripts.get(ownerId) || null : null;
  }
  function transcriptForVoiceProps(props) {
    try {
      const visited = new Set();
      const queue = [{ value: props, depth: 0 }];
      let examined = 0;
      while (queue.length && examined++ < 80) {
        const item = queue.shift();
        const value = item && item.value;
        if (!value || typeof value !== "object" || visited.has(value) || item.depth > 5) continue;
        visited.add(value);
        const objectOwner = voiceAttachmentObjectOwners.get(value);
        if (objectOwner && transcripts.has(objectOwner)) return transcripts.get(objectOwner);
        for (const key of ["messageId", "message_id", "messageID", "channelMessageId", "id", "attachmentId", "attachment_id"]) {
          const match = transcriptForIdentifier(value[key]);
          if (match) return match;
        }
        if (item.depth < 5) {
          for (const key of Object.keys(value)) {
            const child = value[key];
            if (typeof child === "string") {
              const match = transcriptForIdentifier(child);
              if (match) return match;
            }
            if (child && typeof child === "object") queue.push({ value: child, depth: item.depth + 1 });
          }
        }
      }
      return null;
    } catch (_) { return null; }
  }
  function transcriptView(player, transcript) {
    return React.createElement(RN.View, { style: { alignSelf: "stretch" } },
      player,
      React.createElement(RN.Text, { selectable: true, style: { color: ACCENT, fontSize: 16, lineHeight: 22, marginTop: 6, flexShrink: 1 } }, transcript.text));
  }
  function patchWrappedComponentType(type) {
    if (!type || typeof type !== "object") return null;
    if (typeof type.render === "function") {
      const originalRender = type.render;
      const wrappedRender = function(props, ref) {
        const player = originalRender.call(this, props, ref);
        const transcript = cfg().inline !== false && cfg().position === "below" ? transcriptForVoiceProps(props) : null;
        return transcript ? transcriptView(player, transcript) : player;
      };
      try { type.render = wrappedRender; }
      catch (_) { return null; }
      return () => { try { if (type.render === wrappedRender) type.render = originalRender; } catch (_) {} };
    }
    if (type.$$typeof === Symbol.for("react.memo") && type.type) {
      const originalType = type.type;
      let wrappedType = originalType;
      let restoreInner = null;
      if (typeof originalType === "function") {
        wrappedType = function VoiceTranscriptMemoInner(props) {
          const transcript = cfg().inline !== false && cfg().position === "below" ? transcriptForVoiceProps(props) : null;
          const player = React.createElement(originalType, props);
          return transcript ? transcriptView(player, transcript) : player;
        };
      } else {
        restoreInner = patchWrappedComponentType(originalType);
        if (!restoreInner) return null;
      }
      try { type.type = wrappedType; }
      catch (_) { if (restoreInner) restoreInner(); return null; }
      return () => {
        try { if (type.type === wrappedType) type.type = originalType; } catch (_) {}
        if (restoreInner) restoreInner();
      };
    }
    return null;
  }
  function patchElementFactories(component) {
    const installed = [];
    const patchFactory = (target, method) => {
      if (!target || typeof target[method] !== "function") return;
      try {
        installed.push(patcher.instead(method, target, (args, original) => {
          if (!args || args[0] !== component) return original(...args);
          const props = args[1] || {};
          const transcript = cfg().inline !== false && cfg().position === "below" ? transcriptForVoiceProps(props) : null;
          const player = original(...args);
          return transcript ? transcriptView(player, transcript) : player;
        }));
      } catch (_) {}
    };
    patchFactory(React, "createElement");
    const jsxRuntime = safe(() => findByProps("jsx", "jsxs"), null);
    patchFactory(jsxRuntime, "jsx");
    patchFactory(jsxRuntime, "jsxs");
    patchFactory(jsxRuntime, "jsxDEV");
    if (!installed.length) return null;
    return () => installed.splice(0).forEach((unpatch) => { try { unpatch(); } catch (_) {} });
  }
  function patchVoiceMessageComponent() {
    const findByFilePath = metro.findByFilePath;
    const exports = typeof findByFilePath === "function" ? safe(() => findByFilePath(VOICE_MESSAGE_COMPONENT_PATH, false), null) : null;
    if (!exports || !exports.default) {
      const component = safe(() => findByName("VoiceMessageChat"), null);
      if (!component) return false;
      voiceComponentUnpatch = typeof component === "function" ? patchElementFactories(component) : patchWrappedComponentType(component);
      return !!voiceComponentUnpatch;
    }
    if (typeof exports.default !== "function") {
      voiceComponentUnpatch = patchWrappedComponentType(exports.default);
      return !!voiceComponentUnpatch;
    }
    voiceComponentUnpatch = patchElementFactories(exports.default);
    return !!voiceComponentUnpatch;
  }

  /* ---- long-press menu on a voice message ---- */
  const MIC_ICONS = ["MicrophoneIcon", "MicIcon", "ic_mic", "ic_microphone"];
  function micAsset() { for (const n of MIC_ICONS) { const id = kitAsset(n); if (id) return id; } return null; }
  function messagePlan(message) {
    if (!message || !message.id || !voiceAttachment(message)) return null;
    const id = String(message.id);
    const plan = [];
    if (transcripts.has(id)) {
      plan.push({ key: "vt-show", label: "Show transcript", press: () => openResult(id) });
      plan.push({ key: "vt-copy", label: "Copy transcript", press: () => copyText(transcripts.get(id).text) });
      plan.push({ key: "vt-remove", label: "Remove transcript", press: () => removeTranscript(id) });
    } else plan.push({ key: "vt-transcribe", label: "Transcribe voice message", press: () => transcribeMessage(message) });
    return plan;
  }
  function addRows(tree, plan, lazySheet) {
    const findInReactTree = rainRuntime.utils && rainRuntime.utils.findInReactTree;
    if (!findInReactTree) return;
    const container = findInReactTree(tree, (x) => Array.isArray(x) && x[0] && x[0].type && x[0].type.name === "ActionSheetRowGroup");
    if (!container || !container[1]) return;
    const group = container[1];
    const children = group.props && group.props.children;
    if (!Array.isArray(children) || !children[0]) return;
    if (children.some((c) => c && typeof c.key === "string" && c.key.indexOf("vt-") === 0)) return;
    const tpl = children[0];
    const Row = tpl.type;
    const iconId = micAsset();
    const tplIcon = tpl.props && tpl.props.icon;
    const icon = tplIcon && iconId ? { $$typeof: tplIcon.$$typeof, type: tplIcon.type, key: null, ref: null,
      props: { IconComponent: () => React.createElement(RN.Image, { resizeMode: "cover", style: { width: 24, height: 24, tintColor: palette().text }, source: iconId }) } } : tplIcon;
    const rows = plan.map((item) => React.createElement(Row, { key: item.key, label: item.label, icon,
      onPress: () => { try { lazySheet.hideActionSheet(); } catch (_) {} item.press(); } }));
    const copyIndex = children.findIndex((c) => c && c.props && ((c.props.label && String(c.props.label).toUpperCase().indexOf("COPY") !== -1) || (c.props.message && String(c.props.message).toUpperCase().indexOf("COPY") !== -1)));
    if (copyIndex !== -1) children.splice(copyIndex, 0, ...rows); else children.push(...rows);
  }
  function patchActionSheet() {
    const lazy = lazySheets();
    if (!lazy) return false;
    unpatches.push(patcher.before("openLazy", lazy, ([component, key, ctx]) => {
      try {
        if (key !== "MessageLongPressActionSheet" || !component || typeof component.then !== "function") return;
        const plan = messagePlan(ctx && ctx.message);
        if (!plan) return;
        component.then((instance) => {
          const un = patcher.after("default", instance, (_, tree) => {
            React.useEffect(() => () => { un(); }, []);
            try { addRows(tree, plan, lazy); } catch (_) {}
          });
        });
      } catch (_) {}
    }));
    return true;
  }

  /* ---- automatic mode ---- */
  function onCreate(ev) {
    try {
      const m = ev && ev.message;
      if (!m || ev.optimistic) return;
      const mode = cfg().auto;
      if (!mode || mode === "off" || !configured()) return;
      if (!voiceAttachment(m)) return;
      if (m.author && String(m.author.id) === myId()) return;
      if (mode === "dms" && !isDM(getChannel(m.channel_id || ev.channelId))) return;
      transcribeMessage(m, { auto: true });
    } catch (_) {}
  }

  /* ---- result card ---- */
  function ResultSheet() {
    const C = palette(), h = React.createElement;
    const parts = sheetParts();
    const id = sheetState.id;
    const tr = id ? transcripts.get(id) : null;
    const sub = tr ? ["Voice message", tr.dur ? fmtDur(tr.dur) : null, tr.by].filter(Boolean).join(" \u00B7 ") : "";
    const again = () => {
      const t = transcripts.get(id);
      closeSheet();
      if (!t) return;
      const msg = getMessage(t.channelId, id);
      if (!msg) { toast("Open the chat with this message first"); return; }
      removeTranscript(id);
      timers.push(setTimeout(() => transcribeMessage(msg), 250));
    };
    const body = h(RN.View, { style: { paddingHorizontal: 16, paddingBottom: 16 } },
      h(RN.View, { style: { flexDirection: "row", alignItems: "center", paddingTop: 2, paddingBottom: 12 } },
        KitTile({ k: "mic", size: 40 }),
        h(RN.View, { style: { flex: 1 } },
          h(RN.Text, { numberOfLines: 1, style: { color: C.text, fontSize: 20, fontWeight: "800" } }, "Transcript"),
          sub ? h(RN.Text, { numberOfLines: 1, style: { color: C.sub, fontSize: 13, marginTop: 2 } }, sub) : null),
        parts.Close ? h(parts.Close, { onPress: closeSheet }) : null),
      h(RN.ScrollView, { style: { maxHeight: Math.round(RN.Dimensions.get("window").height * 0.36) }, showsVerticalScrollIndicator: false, nestedScrollEnabled: true },
        h(RN.View, { style: { backgroundColor: C.card, borderRadius: 20, borderWidth: 1, borderColor: C.card2, padding: 16 } },
          h(RN.Text, { selectable: true, style: { color: C.text, fontSize: 16, lineHeight: 23 } }, tr ? tr.text : "This transcript is no longer available."))),
      tr ? h(RN.View, { style: { marginTop: 14 } },
        h(CustomAction, { title: "Copy text", compact: true, top: 0, onPress: () => copyText(tr.text) }),
        h(CustomAction, { title: "Transcribe again", compact: true, secondary: true, top: 10, onPress: again })) : null);
    return parts.ActionSheet ? h(parts.ActionSheet, null, body) : body;
  }

  /* ---- settings ---- */
  function SelectRow(p) {
    const C = palette(), h = React.createElement;
    return h(CustomRow, { title: p.title, subtitle: p.subtitle, icon: p.icon, last: p.last, onPress: p.onPress,
      trailing: h(RN.View, { style: { flexDirection: "row", alignItems: "center", maxWidth: 150 } },
        h(RN.Text, { numberOfLines: 1, style: { color: C.sub, fontSize: 14, marginRight: 4, flexShrink: 1 } }, p.value),
        KitChevron({ dir: "down", color: C.sub, size: 8 })) });
  }
  function pick(title, key, options, current, onPick) {
    const sheets = safe(() => findByProps("showSimpleActionSheet"), null);
    if (!sheets || typeof sheets.showSimpleActionSheet !== "function") { toast("Could not open the list"); return; }
    sheets.showSimpleActionSheet({ key, header: { title }, options: options.map((o) => ({
      label: (o[0] === current ? "\u2713 " : "") + o[1],
      onPress: () => { try { const l = lazySheets(); l && l.hideActionSheet && l.hideActionSheet(); } catch (_) {} onPick(o[0]); } })) });
  }
  function KeyField(p) {
    const C = palette(), h = React.createElement;
    const [shown, setShown] = React.useState(false);
    const [value, setValue] = React.useState(String(cfg().apiKey || ""));
    return h(RN.View, { style: { paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: C.card2 } },
      h(RN.View, { style: { flexDirection: "row", alignItems: "center", marginBottom: 10 } },
        KitTile({ k: "key", size: 34 }),
        h(RN.View, { style: { flex: 1 } },
          h(RN.Text, { style: { color: C.text, fontSize: 16, fontWeight: "600" } }, "API key"),
          h(RN.Text, { style: { color: C.sub, fontSize: 13, marginTop: 2 } }, "Get it free: open console.groq.com/keys, tap Create API Key, then paste it here. Stays on this device.")),
        h(RN.Pressable, { onPress: () => setShown(!shown), hitSlop: 10, style: ({ pressed }) => ({ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: pressed ? C.press : C.chip }) },
          h(RN.Text, { style: { color: C.text, fontSize: 13, fontWeight: "600" } }, shown ? "Hide" : "Show"))),
      h(CustomInput, { value, placeholder: "Paste your API key", secureTextEntry: !shown, autoCapitalize: "none", autoCorrect: false, spellCheck: false,
        onChangeText: (v) => { setValue(v); setSetting("apiKey", v.trim()); p.onChange && p.onChange(); } }));
  }
  function UrlField() {
    const C = palette(), h = React.createElement;
    const [value, setValue] = React.useState(String(cfg().serverUrl || ""));
    return h(RN.View, { style: { paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: C.card2 } },
      h(RN.View, { style: { flexDirection: "row", alignItems: "center", marginBottom: 10 } },
        KitTile({ k: "server", size: 34 }),
        h(RN.View, { style: { flex: 1 } },
          h(RN.Text, { style: { color: C.text, fontSize: 16, fontWeight: "600" } }, "Server address"),
          h(RN.Text, { style: { color: C.sub, fontSize: 13, marginTop: 2 } }, DEFAULT_SERVER ? "Leave empty to use the built-in server." : "The address of your transcription server."))),
      h(CustomInput, { value, placeholder: DEFAULT_SERVER || "https://your-server.workers.dev", autoCapitalize: "none", autoCorrect: false, spellCheck: false, keyboardType: "url",
        onChangeText: (v) => { setValue(v); setSetting("serverUrl", v.trim()); } }));
  }
  function Settings() {
    rainStore.useStore();
    const [, bump] = React.useState(0);
    const C = palette(), h = React.createElement;
    const s = cfg(), p = provider();
    const redraw = () => bump((x) => x + 1);
    const toggle = (key, title, subtitle, icon, last = false, after = undefined) => h(CustomRow, { key, title, subtitle, icon, last: !!last,
      trailing: h(CustomSwitch, { value: s[key] !== false && !!s[key], onChange: (v) => { setSetting(key, v); redraw(); if (after) after(v); } }) });
    const model = p.models.some((x) => x[0] === s.model) ? s.model : p.models[0][0];
    const guide = h(KitGuide, { key: "guide", title: "Quick guide", steps: [
      ["Choose a service", "Free server (no key) works right away, nothing to paste. Or pick Groq (also free) and paste your own API key: open console.groq.com/keys, sign in, tap Create API Key, copy it here, then tap Test connection."],
      ["Transcribe a message", "Long-press any voice message and choose Transcribe voice message. The text appears on the voice message, above or below it (see Display). Long-press it again to copy it."],
      ["Language", "Auto-detect works for most voice messages. Pick a language if short messages are misread."],
      ["Automatic mode", "Transcribes new incoming voice messages by itself, in direct messages or in every chat. Each one is a request to your service, so it uses your quota."],
      ["Privacy", "The link to the audio is sent to the service you chose when a message is transcribed. Nothing goes anywhere else."],
    ] });
    return h(RN.ScrollView, { style: { flex: 1 }, keyboardShouldPersistTaps: "handled", contentContainerStyle: { padding: 16, paddingBottom: 42 } },
      h(KitHero, { key: "hero", icon: "mic", title: "Voice Messages to Text", subtitle: "Read voice messages as text", stats: [["Transcribed", transcripts.size], ["Service", p.name]] }),
      h(CustomSection, { key: "service", title: "Service", footer: p.server ? "No API key needed. Or switch to Groq to use your own key. The link to the audio is sent to the server only when a message is transcribed." : "Audio is sent to the selected service only when a message is transcribed." },
        h(SelectRow, { key: "provider", title: "Service", icon: "server", value: p.name, onPress: () => pick("Service", "VTProvider", Object.keys(PROVIDERS).map((k) => [k, PROVIDERS[k].name]), s.provider,
          (v) => { setSetting("provider", v); setSetting("model", PROVIDERS[v].models[0][0]); redraw(); }) }),
        p.server ? null : h(SelectRow, { key: "model", title: "Model", icon: "power", value: nameOf(p.models, model).split(" (")[0], onPress: () => pick("Model", "VTModel", p.models, model, (v) => { setSetting("model", v); redraw(); }) }),
        h(SelectRow, { key: "language", title: "Language", icon: "lang", value: nameOf(LANGS, s.language), last: false, onPress: () => pick("Language", "VTLanguage", LANGS, s.language, (v) => { setSetting("language", v); redraw(); }) }),
        p.server ? (DEFAULT_SERVER ? null : h(UrlField, { key: "url" })) : h(KeyField, { key: "key" + s.provider }),
        h(CustomAction, { key: "test", title: "Test connection", secondary: true, compact: true, onPress: testConnection })),
      h(CustomSection, { key: "display", title: "Display" },
        toggle("inline", "Show text on voice messages", "Show the text next to the voice message.", "text"),
        h(SelectRow, { key: "position", title: "Text position", subtitle: "Below is experimental: some themes draw its text in black.", icon: "text", value: s.position === "below" ? "Below" : "Above",
          onPress: () => pick("Text position", "VTPosition", [["above", "Above the voice message (readable)"], ["below", "Below the voice message (experimental)"]], s.position === "below" ? "below" : "above", (v) => { setSetting("position", v); Array.from(transcripts.values()).forEach((t) => refreshRow(t.channelId, t.id)); redraw(); }) }),
        s.position === "below" ? h(SelectRow, { key: "textStyle", title: "Text style (below only)", subtitle: "Try each one until the text is easy to read.", icon: "text", value: nameOf(TEXT_STYLES, s.textStyle || "link"),
          onPress: () => pick("Text style", "VTStyle", TEXT_STYLES, s.textStyle || "link", (v) => { setSetting("textStyle", v); Array.from(transcripts.values()).forEach((t) => refreshRow(t.channelId, t.id)); redraw(); }) }) : null,
        toggle("card", "Also open a result card", "Open a card with a Copy button when the text is ready.", "guide", true)),
      h(CustomSection, { key: "auto", title: "Automatic" },
        h(SelectRow, { key: "auto", title: "Auto-transcribe", subtitle: "Transcribe new incoming voice messages by themselves.", icon: "bell", value: nameOf(AUTO_MODES, s.auto || "off").replace(" only", ""), last: true,
          onPress: () => pick("Auto-transcribe", "VTAuto", AUTO_MODES, s.auto || "off", (v) => { setSetting("auto", v); redraw(); }) })),
      h(CustomSection, { key: "history", title: "History", footer: "Up to " + MAX_TRANSCRIPTS + " transcripts are kept so they are still there after a restart." },
        toggle("saveTranscripts", "Remember transcripts", "Keep transcripts after closing the app.", "store", false, (v) => { if (v) persist(); else setSetting("transcripts", []); }),
        h(CustomAction, { key: "clear", title: "Clear transcripts (" + transcripts.size + ")", danger: true, secondary: true, compact: true, disabled: !transcripts.size,
          onPress: () => { const ids = Array.from(transcripts.values()); transcripts.clear(); setSetting("transcripts", []); ids.forEach((t) => refreshRow(t.channelId, t.id)); redraw(); toast("Transcripts cleared"); } })),
      guide,
      h(RN.Text, { style: { color: C.sub, fontSize: 12, textAlign: "center", marginTop: 1, opacity: 0.7 } }, "Voice Messages to Text " + BUILD));
  }

  /* ---- lifecycle ---- */
  function initializeAfterHydration() {
    if (!loadRequested || initialized) return;
    initialized = true;
    const s = cfg();
    const defaults = { provider: DEFAULT_SERVER ? "server" : "groq", serverUrl: "", model: "whisper-large-v3-turbo", language: "auto", inline: true, card: false, auto: "off", saveTranscripts: true };
    const missing = {};
    for (const k of Object.keys(defaults)) if (s[k] === undefined) missing[k] = defaults[k];
    if (Object.keys(missing).length) rainStore.useStore.getState().updateSettings(missing);
    loadSaved();
    if (!patchRender()) toast("Voice Messages to Text: could not find the message list, text on voice messages is unavailable");
    if (!patchVoiceMessageComponent() && cfg().position === "below") toast("Voice Messages to Text: below-player text is unavailable in this Discord build; switch Text position to Above");
    if (!patchActionSheet()) toast("Voice Messages to Text: could not add the menu entry");
    try { FluxDispatcher.subscribe("MESSAGE_CREATE", onCreate); unpatches.push(() => FluxDispatcher.unsubscribe("MESSAGE_CREATE", onCreate)); } catch (_) {}
  }
  function onLoad() {
    loadRequested = true;
    renderErrors = 0;
    const store = rainStore.useStore;
    if (store.getState()._hasHydrated) { initializeAfterHydration(); return; }
    const check = (state) => {
      if (!loadRequested || !state._hasHydrated) return;
      if (hydrationUnsubscribe) hydrationUnsubscribe();
      hydrationUnsubscribe = null;
      initializeAfterHydration();
    };
    hydrationUnsubscribe = store.subscribe(check);
    check(store.getState());
  }
  function onUnload() {
    loadRequested = false;
    if (hydrationUnsubscribe) { hydrationUnsubscribe(); hydrationUnsubscribe = null; }
    initialized = false;
    for (const t of timers.splice(0)) clearTimeout(t);
    for (const u of unpatches.splice(0)) { try { u(); } catch (_) {} }
    if (renderUnpatch) { try { renderUnpatch(); } catch (_) {} renderUnpatch = null; }
    if (voiceComponentUnpatch) { try { voiceComponentUnpatch(); } catch (_) {} voiceComponentUnpatch = null; }
    closeSheet();
    transcripts.clear();
    voiceAttachmentOwners.clear();
    busy.clear();
    partsCache = null;
  }

  return { onLoad, onUnload, settings: Settings };
})();

module.exports = {
  start() { implementation.onLoad(); },
  stop() { implementation.onUnload(); },
  settings: implementation.settings,
};
