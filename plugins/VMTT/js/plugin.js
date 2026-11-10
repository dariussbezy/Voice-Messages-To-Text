import { Design } from "@valenced/discord/design";
import {
  NativeSection as CustomSection,
  NativeRow as CustomRow,
  NativeSwitch as CustomSwitch,
  NativeAction as CustomAction,
  rowIcon,
  settingsContent,
  NativeGuide as KitGuide,
} from "../../../shared/native-ui";
import * as React from "react";
import * as RN from "react-native";
import { Clipboard as clipboard } from "@valenced/externals/react-native-clipboard";
import { onFluxEventDispatched } from "@valenced/discord/flux";
import {
  findByProps,
  findByStoreName,
  patcher,
  observeName,
  showToast,
  injectMessageActions,
  CompactSheet,
} from "./valenced";
import { createPluginStore } from "./settings-store";
const DEFAULT_SERVER = "https://small-bread-a3d3.dariussbezy.workers.dev";
const DEFAULT_TOKEN = "";
const settingsStore = createPluginStore("voicetotext", {
  provider: "server",
  apiKey: "",
  serverUrl: "",
  model: "whisper-large-v3-turbo",
  language: "auto",
  inline: true,
  card: false,
  auto: "off",
  saveTranscripts: true,
  transcripts: [],
});
const implementation = (() => {
  "use strict";
  const BUILD = "1.0.0-beta";
  const SHEET_KEY = "voice-transcript";
  const FLAG_VOICE = 8192;
  const ACCENT = "#8EA1FF";
  const MAX_TRANSCRIPTS = 200;
  const TIMEOUT = 90000;
  const PROVIDERS = {
    server: {
      name: "Free server (no key)",
      base: "",
      server: true,
      models: [["whisper-large-v3-turbo", "Whisper large v3 turbo"]],
    },
    groq: {
      name: "Groq",
      base: "https://api.groq.com/openai/v1",
      models: [
        ["whisper-large-v3-turbo", "Whisper large v3 turbo (fast)"],
        ["whisper-large-v3", "Whisper large v3 (accurate)"],
      ],
    },
  };
  const LANGS = [
    ["auto", "Auto-detect"],
    ["en", "English"],
    ["ro", "Romanian"],
    ["es", "Spanish"],
    ["fr", "French"],
    ["de", "German"],
    ["it", "Italian"],
    ["pt", "Portuguese"],
    ["ru", "Russian"],
    ["uk", "Ukrainian"],
    ["pl", "Polish"],
    ["nl", "Dutch"],
    ["tr", "Turkish"],
    ["ar", "Arabic"],
    ["he", "Hebrew"],
    ["hi", "Hindi"],
    ["ja", "Japanese"],
    ["ko", "Korean"],
    ["zh", "Chinese"],
    ["cs", "Czech"],
    ["sv", "Swedish"],
    ["hu", "Hungarian"],
    ["el", "Greek"],
    ["bg", "Bulgarian"],
    ["id", "Indonesian"],
    ["vi", "Vietnamese"],
    ["th", "Thai"],
  ];
  const AUTO_MODES = [
    ["off", "Off"],
    ["dms", "Direct messages only"],
    ["all", "All chats"],
  ];

  const unpatches = [];
  const timers = [];
  const transcripts = new Map();
  const busy = new Set();
  let partsCache = null;
  let loadRequested = false;
  let initialized = false;
  let hydrationUnsubscribe = null;
  let renderUnpatch = null;
  let sheetState = { id: null };

  const cfg = () => settingsStore.useStore.getState();
  const setSetting = (key, value) =>
    settingsStore.useStore.getState().updateSettings({ [key]: value });
  const toast = (t) => {
    try {
      showToast(t);
    } catch (_) {}
  };
  const safe = (fn, fallback) => {
    try {
      return fn();
    } catch (_) {
      return fallback;
    }
  };
  const provider = () => PROVIDERS[cfg().provider] || PROVIDERS.server;
  const serverEndpoint = () =>
    String(cfg().serverUrl || "").trim() || DEFAULT_SERVER;
  const configured = () =>
    provider().server
      ? !!serverEndpoint()
      : !!String(cfg().apiKey || "").trim();
  const nameOf = (list, code) => {
    const hit = list.find((x) => x[0] === code);
    return hit ? hit[1] : String(code);
  };
  const MessageStore = () => safe(() => findByStoreName("MessageStore"), null);
  const ChannelStore = () => safe(() => findByStoreName("ChannelStore"), null);
  const UserStore = () => safe(() => findByStoreName("UserStore"), null);
  const getMessage = (c, id) =>
    safe(() => MessageStore().getMessage(c, id) || null, null);
  const getChannel = (id) =>
    safe(() => (id ? ChannelStore().getChannel(id) : null), null);
  const isDM = (ch) => !!ch && (ch.type === 1 || ch.type === 3);
  const myId = () => safe(() => String(UserStore().getCurrentUser().id), "");

  /* ---- original settings design ---- */

  /* ---- settings design ---- */

  /* ---- voice message detection ---- */
  const attachmentsOf = (m) => {
    const a = m && (m.attachments || m.attachment);
    return Array.isArray(a) ? a : [];
  };
  const attUrl = (a) =>
    (a && (a.url || a.proxy_url || a.proxyURL || a.proxyUrl)) || null;
  const isAudio = (a) => {
    if (!a) return false;
    const t = String(a.content_type || a.contentType || "").toLowerCase();
    return (
      t.indexOf("audio/") === 0 ||
      /\.(ogg|opus|mp3|m4a|wav)$/i.test(String(a.filename || ""))
    );
  };
  function voiceAttachment(m) {
    if (!m) return null;
    const atts = attachmentsOf(m);
    for (const a of atts)
      if (
        a &&
        (a.waveform ||
          (isAudio(a) && (a.duration_secs != null || a.durationSecs != null)))
      )
        return a;
    if (((m.flags | 0) & FLAG_VOICE) === FLAG_VOICE)
      return atts.find(isAudio) || atts[0] || null;
    return null;
  }
  const durOf = (a) => {
    const d = a && (a.duration_secs != null ? a.duration_secs : a.durationSecs);
    return typeof d === "number" ? d : 0;
  };
  function fmtDur(sec) {
    const s = Math.max(0, Math.round(sec || 0));
    return Math.floor(s / 60) + ":" + (s % 60 < 10 ? "0" : "") + (s % 60);
  }

  /* ---- transcripts (memory + saved) ---- */
  function loadSaved() {
    transcripts.clear();
    const list = cfg().transcripts;
    if (cfg().saveTranscripts === false || !Array.isArray(list)) return;
    for (const t of list.slice(-MAX_TRANSCRIPTS))
      if (t && t.id && typeof t.text === "string")
        transcripts.set(String(t.id), t);
  }
  function persist() {
    while (transcripts.size > MAX_TRANSCRIPTS) {
      const id = transcripts.keys().next().value;
      const t = transcripts.get(id);
      transcripts.delete(id);
      refreshRow(t.channelId, id);
    }
    if (cfg().saveTranscripts === false) return;
    setSetting("transcripts", Array.from(transcripts.values()));
  }

  /* ---- re-render a message row ---- */
  const pendingRows = new Set();
  const controllers = new Set();
  let epoch = 0;
  let activeRequests = 0;
  const queue = [];
  function refreshRow(channelId, id) {
    pendingRows.add(String(id));
    while (pendingRows.size > MAX_TRANSCRIPTS)
      pendingRows.delete(pendingRows.values().next().value);
    try {
      findByProps("dispatch", "subscribe")?.dispatch({
        type: "MESSAGE_UPDATE",
        message: { id, channel_id: channelId },
      });
    } catch (_) {}
  }
  function refreshAll() {
    for (const t of transcripts.values()) refreshRow(t.channelId, t.id);
  }
  function cancelRequests() {
    epoch++;
    for (const controller of controllers) controller.abort();
    controllers.clear();
    for (const job of queue.splice(0)) job.resolve();
    busy.clear();
  }
  function schedule(work, automatic) {
    if (activeRequests >= 2 && queue.length >= 20)
      return Promise.reject(
        new Error("Too many pending transcriptions; try again shortly"),
      );
    return new Promise((resolve, reject) => {
      const job = { work, resolve, reject };
      if (automatic) queue.push(job);
      else queue.unshift(job);
      drainQueue();
    });
  }
  function drainQueue() {
    while (activeRequests < 2 && queue.length) {
      const job = queue.shift();
      activeRequests++;
      Promise.resolve()
        .then(job.work)
        .then(job.resolve, job.reject)
        .finally(() => {
          activeRequests--;
          drainQueue();
        });
    }
  }
  async function fetchT(url, opts = undefined) {
    const controller = new AbortController();
    controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), TIMEOUT);
    try {
      const response = await fetch(url, { ...opts, signal: controller.signal });
      // Keep the timeout active until the body has been read as well.
      const text = await response.text();
      return {
        ok: response.ok,
        status: response.status,
        json: async () => JSON.parse(text),
      };
    } finally {
      clearTimeout(timer);
      controllers.delete(controller);
    }
  }

  const errText = (e) =>
    e && e.name === "AbortError"
      ? "The request timed out"
      : e && e.message
        ? e.message
        : "unknown error";
  async function explain(res, server = provider().server) {
    let detail = "";
    try {
      const j = await res.json();
      detail =
        (j &&
          j.error &&
          (typeof j.error === "string" ? j.error : j.error.message)) ||
        "";
    } catch (_) {}
    const s = res.status;
    if (s === 401 || s === 403)
      return server
        ? "The server rejected the request (check the token)"
        : "The API key was rejected";
    if (s === 413) return "This voice message is too large for the service";
    if (s === 429) return "Rate limit reached, try again in a moment";
    if (s >= 500) return "The service is unavailable right now";
    return detail
      ? String(detail).slice(0, 140)
      : "The service could not read this audio (" + s + ")";
  }
  function transcriptionResult(data, settings) {
    const raw = String(
      data?.language ||
        data?.detected_language ||
        data?.detectedLanguage ||
        (settings.language !== "auto" ? settings.language : "") ||
        "",
    ).trim();
    const known = LANGS.find(
      ([code, name]) =>
        code !== "auto" &&
        (code === raw.toLowerCase() ||
          name.toLowerCase() === raw.toLowerCase()),
    );
    const language = known
      ? known[1]
      : raw && raw.toLowerCase() !== "auto"
        ? raw
        : "Unknown language";
    return { text: String(data?.text || "").trim(), language };
  }
  async function callService(att, s = { ...cfg() }) {
    const p = PROVIDERS[s.provider] || PROVIDERS.server;
    const url = attUrl(att);
    if (!url) throw new Error("This message has no audio file");
    if (p.server) {
      const endpoint = String(s.serverUrl || "").trim() || DEFAULT_SERVER;
      if (!endpoint)
        throw new Error("Set the server address in the plugin settings first");
      const payload = {
        url,
        language: s.language && s.language !== "auto" ? s.language : undefined,
        response_format: "verbose_json",
      };
      const headers = { "Content-Type": "application/json" };
      if (DEFAULT_TOKEN) headers["x-token"] = DEFAULT_TOKEN;
      const r = await fetchT(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error(await explain(r, true));
      const d = await r.json();
      const t = String(d && d.text != null ? d.text : "").trim();
      if (!t) throw new Error("No speech was found in this voice message");
      return transcriptionResult(d, s);
    }
    const key = String(s.apiKey || "").trim();
    if (!key) throw new Error("Add your API key in the plugin settings first");
    const model = p.models.some((x) => x[0] === s.model)
      ? s.model
      : p.models[0][0];
    const form = new FormData();
    form.append("model", model);
    form.append("response_format", "verbose_json");
    if (s.language && s.language !== "auto")
      form.append("language", s.language);
    form.append("url", url);
    const res = await fetchT(p.base + "/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: "Bearer " + key },
      body: form,
    });
    if (!res.ok) throw new Error(await explain(res, false));
    const data = await res.json();
    const text = String(data && data.text != null ? data.text : "").trim();
    if (!text) throw new Error("No speech was found in this voice message");
    return transcriptionResult(data, s);
  }
  async function testConnection() {
    const generation = epoch;
    const key = String(cfg().apiKey || "").trim();
    const srv = provider().server;
    if (srv ? !serverEndpoint() : !key) {
      toast(srv ? "Set the server address first" : "Paste your API key first");
      return;
    }
    try {
      const res = srv
        ? await fetchT(serverEndpoint())
        : await fetchT(provider().base + "/models", {
            headers: { Authorization: "Bearer " + key },
          });
      const message = res.ok ? "Connection works" : await explain(res, srv);
      if (loadRequested && generation === epoch) toast(message);
    } catch (e) {
      if (loadRequested && generation === epoch) toast(errText(e));
    }
  }

  /* ---- main action ---- */
  function sheetParts() {
    if (partsCache && partsCache.ActionSheet) return partsCache;
    let ActionSheet = null;
    try {
      const a = findByProps("ActionSheet");
      ActionSheet = (a && a.ActionSheet) || null;
    } catch (_) {}
    partsCache = { ActionSheet };
    return partsCache;
  }
  const lazySheets = () =>
    safe(() => findByProps("openLazy", "hideActionSheet"), null);
  function closeSheet() {
    try {
      const s = lazySheets();
      s && s.hideActionSheet && s.hideActionSheet(SHEET_KEY);
    } catch (_) {}
  }
  function openResult(id) {
    sheetState = { id: String(id) };
    try {
      const s = lazySheets();
      if (s && typeof s.openLazy === "function" && sheetParts().ActionSheet) {
        s.openLazy(Promise.resolve({ default: ResultSheet }), SHEET_KEY, {});
        return true;
      }
    } catch (_) {}
    return false;
  }
  async function detectTranscriptLanguage(entry, requestEpoch, automatic) {
    if (!entry.language || entry.language === "Unknown language") {
      const api = globalThis.__valencedQuickTranslateTextBridge;
      if (
        safe(() => api?.isActive(), false) &&
        typeof api.detectLanguage === "function"
      ) {
        const controller = new AbortController();
        controllers.add(controller);
        try {
          const detected = await api.detectLanguage(entry.text, {
            automatic,
            signal: controller.signal,
          });
          if (
            !loadRequested ||
            epoch !== requestEpoch ||
            transcripts.get(entry.id) !== entry
          )
            return;
          if (detected?.name) {
            entry.language = detected.name;
            persist();
          }
        } catch (_) {
          /* Keep the transcript even when detection is unavailable. */
        } finally {
          controllers.delete(controller);
        }
      }
    }
  }
  async function transcribeMessage(message, opts = undefined) {
    const o = opts || {};
    const id = message && message.id ? String(message.id) : "";
    const att = voiceAttachment(message);
    if (!id || !att) {
      if (!o.auto) toast("This is not a voice message");
      return;
    }
    if (transcripts.has(id)) {
      if (!o.auto && !busy.has(id)) {
        const current = epoch;
        const entry = transcripts.get(id);
        busy.add(id);
        try {
          await detectTranscriptLanguage(entry, current, false);
          if (
            loadRequested &&
            current === epoch &&
            transcripts.get(id) === entry
          )
            openResult(id);
        } finally {
          if (current === epoch) busy.delete(id);
        }
      }
      return;
    }
    if (busy.has(id)) {
      if (!o.auto) toast("Already transcribing this message");
      return;
    }
    busy.add(id);
    const channelId = String(message.channel_id || message.channelId || "");
    const requestEpoch = epoch;
    const settings = { ...cfg() };
    try {
      const result = await schedule(() => {
        if (!loadRequested || epoch !== requestEpoch) return;
        return callService(att, settings);
      }, !!o.auto);
      if (!loadRequested || epoch !== requestEpoch || !result?.text) return;
      const entry = {
        id,
        channelId,
        text: result.text,
        language: result.language,
        at: Date.now(),
        dur: durOf(att),
        by: (PROVIDERS[settings.provider] || PROVIDERS.server).name,
      };
      transcripts.set(id, entry);
      persist();
      refreshRow(channelId, id);
      await detectTranscriptLanguage(entry, requestEpoch, !!o.auto);
      if (
        !loadRequested ||
        epoch !== requestEpoch ||
        transcripts.get(id) !== entry
      )
        return;
      if (!o.auto) {
        toast(
          "Transcribed with " +
            (PROVIDERS[settings.provider] || PROVIDERS.server).name +
            " · from " +
            entry.language,
        );
        if (cfg().card === true || cfg().inline === false || !renderReady)
          openResult(id);
      }
    } catch (e) {
      if (loadRequested && epoch === requestEpoch && !o.auto)
        toast("Transcription failed: " + errText(e));
    } finally {
      if (epoch === requestEpoch) busy.delete(id);
    }
  }
  function removeTranscript(id) {
    const t = transcripts.get(id);
    transcripts.delete(id);
    persist();
    if (t) refreshRow(t.channelId, id);
  }
  function quickTranslateActions(transcript) {
    const api = safe(
      () =>
        globalThis.__valencedQuickTranslateTextBridge ||
        globalThis.__rainQuickTranslateTextBridge,
      null,
    );
    if (!api || !safe(() => api.isActive(), false) || !transcript) return [];
    const message = {
      id: String(transcript.id || ""),
      channel_id: String(transcript.channelId || ""),
      content: String(transcript.text || ""),
    };
    const actions = safe(() => api.getMessageActions(message), []);
    return Array.isArray(actions) ? actions : [];
  }
  function copyText(text) {
    try {
      clipboard.setString(text);
      toast("Copied");
    } catch (_) {
      toast("Could not copy");
    }
  }

  /* ---- inline text on the voice message ---- */
  const EMBED_PREFIX = "dariuss-voice-transcript:";
  const textNode = (text) => ({ type: "text", content: text });
  function stripTranslation(nodes) {
    return nodes
      .filter((n) => !n?.__tr)
      .map((n) =>
        Array.isArray(n?.content)
          ? { ...n, content: stripTranslation(n.content) }
          : n,
      );
  }
  function decorate(row, input) {
    const original = row?.message;
    if (!original) return row;
    const id = String(original.id);
    const transcript = cfg().inline !== false && transcripts.get(id);
    const dirty = pendingRows.delete(id);
    const embeds = Array.isArray(original.embeds) ? original.embeds : [];
    const clean = embeds.filter(
      (e) => !String(e?.id || "").startsWith(EMBED_PREFIX),
    );
    if (!transcript && !dirty && clean.length === embeds.length) return row;
    const message = { ...original, embeds: clean };
    if (transcript) {
      const api =
        globalThis.__valencedQuickTranslateTextBridge ||
        globalThis.__rainQuickTranslateTextBridge;
      const translated = safe(
        () => api?.isActive() && api.getMessageTranslation?.(id),
        null,
      );
      let nodes = [textNode(transcript.text)];
      let color = RN.processColor(ACCENT);
      if (translated?.text?.trim()) {
        if (Array.isArray(message.content))
          message.content = stripTranslation(message.content);
        const translatedColor = RN.processColor(translated.color || ACCENT);
        const translation = [
          {
            type: "link",
            target: { linkColor: translatedColor, medium: false },
            linkColor: translatedColor,
            content: [
              textNode(
                (translated.sourceLabel ? translated.sourceLabel + "\n" : "") +
                  translated.text,
              ),
            ],
          },
        ];
        nodes =
          translated.immersive === false
            ? translation
            : [...nodes, textNode("\n\n"), ...translation];
      }
      message.embeds = [
        ...clean,
        {
          id: EMBED_PREFIX + id,
          type: "rich",
          spoiler: "",
          obscure: "",
          obscureAwaitingScan: "",
          verifyAge: false,
          obscureHideControls: false,
          obscureIsOpaque: false,
          rawDescription: transcript.text,
          description: nodes,
          bodyTextColor: color,
        },
      ];
    }
    return { ...row, message, changeType: 2 };
  }
  let renderReady = false;
  function patchRender() {
    renderUnpatch = observeName("RowManager", (RowManager) => {
      if (renderReady || typeof RowManager?.prototype?.generate !== "function")
        return;
      renderReady = true;
      unpatches.push(
        patcher.after("generate", RowManager.prototype, (args, result) => {
          try {
            return decorate(result, args[0]);
          } catch (_) {
            return result;
          }
        }),
      );
      refreshAll();
    });
    return true;
  }

  /* ---- long-press menu on a voice message ---- */
  function messagePlan(message) {
    if (!message || !message.id || !voiceAttachment(message)) return null;
    const id = String(message.id);
    const plan = [];
    if (transcripts.has(id)) {
      plan.push({
        key: "vt-show",
        label: "Show transcript",
        press: () => openResult(id),
      });
      plan.push({
        key: "vt-copy",
        label: "Copy transcript",
        press: () => copyText(transcripts.get(id).text),
      });
      plan.push({
        key: "vt-remove",
        label: "Remove transcript",
        press: () => removeTranscript(id),
      });
      quickTranslateActions(transcripts.get(id)).forEach((action) =>
        plan.push(action),
      );
    } else
      plan.push({
        key: "vt-transcribe",
        label: "Transcribe voice message",
        press: () => transcribeMessage(message),
      });
    return plan;
  }
  function patchActionSheet() {
    const lazy = lazySheets();
    if (!lazy) return false;
    unpatches.push(
      patcher.instead("openLazy", lazy, (args, original) => {
        const [promise, key, context] = args;
        if (key !== "MessageLongPressActionSheet" || !promise?.then)
          return original(...args);
        const plan = messagePlan(context?.message);
        if (!plan?.length) return original(...args);
        const generation = epoch;
        const wrapped = promise.then((module) => {
          if (
            !loadRequested ||
            generation !== epoch ||
            typeof module.default !== "function"
          )
            return module;
          const Original = module.default;
          return {
            ...module,
            default: function VoiceMessageActions(props) {
              const tree = Original(props);
              return loadRequested && generation === epoch
                ? injectMessageActions(tree, plan, () =>
                    lazy.hideActionSheet(key),
                  )
                : tree;
            },
          };
        });
        return original(wrapped, key, context, ...args.slice(3));
      }),
    );
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
      if (mode === "dms" && !isDM(getChannel(m.channel_id || ev.channelId)))
        return;
      transcribeMessage(m, { auto: true });
    } catch (_) {}
  }

  /* ---- result card ---- */
  function ResultSheet() {
    const h = React.createElement;
    const parts = sheetParts();
    const id = sheetState.id;
    const tr = id ? transcripts.get(id) : null;
    const qtActions = tr ? quickTranslateActions(tr) : [];
    const directQtAction = qtActions.find(
      (action) => action.key === "qt-translate",
    );
    const chooseQtAction = qtActions.find(
      (action) => action.key === "qt-translate-to",
    );
    const sub = tr
      ? [tr.language || "Voice message", tr.dur ? fmtDur(tr.dur) : null, tr.by]
          .filter(Boolean)
          .join(" \u00B7 ")
      : "";
    const again = () => {
      const t = transcripts.get(id);
      closeSheet();
      if (!t) return;
      const msg = getMessage(t.channelId, id);
      if (!msg) {
        toast("Open the chat with this message first");
        return;
      }
      removeTranscript(id);
      timers.push(setTimeout(() => transcribeMessage(msg), 250));
    };
    const body = h(
      Design.Stack,
      { spacing: 10, style: { paddingBottom: 8 } },
      h(Design.BottomSheetTitleHeader, { title: "Transcript", subtitle: sub, leading: rowIcon("mic") }),
      h(
        Design.Card,
        { style: { padding: 12 } },
        h(Design.Text, { selectable: true, variant: "text-md/normal" },
          tr ? tr.text : "This transcript is no longer available.",
        ),
      ),
      tr
        ? h(
            RN.View,
            { style: { marginTop: 14 } },
            h(CustomAction, {
              title: "Copy text",
              compact: true,
              top: 0,
              onPress: () => copyText(tr.text),
            }),
            directQtAction
              ? h(CustomAction, {
                  title: directQtAction.label,
                  compact: true,
                  secondary: true,
                  top: 10,
                  onPress: () => {
                    closeSheet();
                    directQtAction.press();
                  },
                })
              : null,
            chooseQtAction
              ? h(CustomAction, {
                  title: "Translate to…",
                  compact: true,
                  secondary: true,
                  top: 10,
                  onPress: () => {
                    closeSheet();
                    chooseQtAction.press();
                  },
                })
              : null,
            h(CustomAction, {
              title: "Transcribe again",
              compact: true,
              secondary: true,
              top: 10,
              onPress: again,
            }),
          )
        : null,
    );
    return parts.ActionSheet
      ? h(
          CompactSheet,
          {
            initialHeight:
              260 +
              Math.ceil((tr?.text.length || 0) / 42) * 23 +
              qtActions.length * 42,
            maxRatio: 0.58,
          },
          body,
        )
      : body;
  }

  /* ---- settings ---- */
  function SelectRow({ title, subtitle, value, onPress, icon }) {
    return React.createElement(Design.TableRow, {
      label: title,
      subLabel: subtitle,
      icon: rowIcon(icon),
      trailing: React.createElement(Design.TableRow.TrailingText, { text: value }),
      arrow: true,
      onPress,
    });
  }
  function pick(title, key, options, current, onPick) {
    const sheets = safe(() => findByProps("showSimpleActionSheet"), null);
    if (!sheets || typeof sheets.showSimpleActionSheet !== "function") {
      toast("Could not open the list");
      return;
    }
    sheets.showSimpleActionSheet({
      key,
      header: { title },
      options: options.map((o) => ({
        label: o[1],
        selected: o[0] === current,
        onPress: () => {
          try {
            const l = lazySheets();
            l && l.hideActionSheet && l.hideActionSheet();
          } catch (_) {}
          onPick(o[0]);
        },
      })),
    });
  }
  function KeyField(p) {
    const h = React.createElement;
    const [shown, setShown] = React.useState(false);
    const [value, setValue] = React.useState(String(cfg().apiKey || ""));
    return h(
      Design.Stack,
      { spacing: 8, style: { padding: 12 } },
      h(Design.TextInput, {
        label: "API key",
        description: "Create a key at console.groq.com/keys. It stays on this device.",
        value,
        placeholder: "Paste your API key",
        secureTextEntry: !shown,
        onChange: (text) => {
          setValue(text);
          setSetting("apiKey", text.trim());
          p.onChange?.();
        },
      }),
      h(Design.Button, {
        text: shown ? "Hide key" : "Show key",
        size: "sm",
        variant: "secondary",
        onPress: () => setShown((current) => !current),
      }),
    );
  }
  function UrlField() {
    const [value, setValue] = React.useState(String(cfg().serverUrl || ""));
    return React.createElement(Design.TextInput, {
      label: "Server address",
      description: DEFAULT_SERVER
        ? "Leave empty to use the built-in server."
        : "The address of your transcription server.",
      value,
      placeholder: "https://your-server.workers.dev",
      onChange: (text) => {
        setValue(text);
        setSetting("serverUrl", text.trim());
      },
    });
  }
  function Settings() {
    settingsStore.useStore();
    const [, bump] = React.useState(0);
    const h = React.createElement;
    const s = cfg(),
      p = provider();
    const redraw = () => bump((x) => x + 1);
    const toggle = (
      key,
      title,
      subtitle,
      icon,
      last = false,
      after = undefined,
    ) =>
      h(CustomRow, {
        key,
        title,
        subtitle,
        icon,
        last: !!last,
        trailing: h(CustomSwitch, {
          value: s[key] !== false && !!s[key],
          onChange: (v) => {
            setSetting(key, v);
            redraw();
            if (after) after(v);
          },
        }),
      });
    const model = p.models.some((x) => x[0] === s.model)
      ? s.model
      : p.models[0][0];
    const guide = h(KitGuide, {
      key: "guide",
      title: "Quick guide",
      steps: [
        [
          "Choose a service",
          "Free server (no key) works right away, nothing to paste. Or pick Groq (also free) and paste your own API key: open console.groq.com/keys, sign in, tap Create API Key, copy it here, then tap Test connection.",
        ],
        [
          "Transcribe a message",
          "Long-press any voice message and choose Transcribe voice message. The transcript appears below the voice message. Long-press it again to copy it.",
        ],
        [
          "Language",
          "Auto-detect works for most voice messages. Pick a language if short messages are misread.",
        ],
        [
          "Automatic mode",
          "Transcribes new incoming voice messages by itself, in direct messages or in every chat. Each one is a request to your service, so it uses your quota.",
        ],
        [
          "Privacy",
          "Audio is sent to your selected transcription service. If it omits the language, an enabled Quick Translate can send transcript text to Google for language detection.",
        ],
      ],
    });
    return h(
      RN.ScrollView,
      {
        style: { flex: 1 },
        keyboardShouldPersistTaps: "handled",
        contentContainerStyle: settingsContent,
      },
      h(
        CustomSection,
        {
          key: "service",
          title: "Service",
          footer: p.server
            ? "No API key needed. Or switch to Groq to use your own key. The link to the audio is sent to the server only when a message is transcribed."
            : "Audio is sent to the selected service only when a message is transcribed.",
        },
        h(SelectRow, {
          key: "provider",
          title: "Service",
          icon: "server",
          value: p.name,
          onPress: () =>
            pick(
              "Service",
              "VTProvider",
              Object.keys(PROVIDERS).map((k) => [k, PROVIDERS[k].name]),
              s.provider,
              (v) => {
                setSetting("provider", v);
                setSetting("model", PROVIDERS[v].models[0][0]);
                redraw();
              },
            ),
        }),
        p.server
          ? null
          : h(SelectRow, {
              key: "model",
              title: "Model",
              icon: "power",
              value: nameOf(p.models, model).split(" (")[0],
              onPress: () =>
                pick("Model", "VTModel", p.models, model, (v) => {
                  setSetting("model", v);
                  redraw();
                }),
            }),
        h(SelectRow, {
          key: "language",
          title: "Language",
          icon: "lang",
          value: nameOf(LANGS, s.language),
          last: false,
          onPress: () =>
            pick("Language", "VTLanguage", LANGS, s.language, (v) => {
              setSetting("language", v);
              redraw();
            }),
        }),
        p.server
          ? h(UrlField, { key: "url" })
          : h(KeyField, { key: "key" + s.provider }),
        h(CustomAction, {
          key: "test",
          title: "Test connection",
          icon: "test",
          secondary: true,
          compact: true,
          onPress: testConnection,
        }),
      ),
      h(
        CustomSection,
        { key: "display", title: "Display" },
        toggle(
          "inline",
          "Show text on voice messages",
          "Show the transcript below the voice message.",
          "text",
          false,
          refreshAll,
        ),
        toggle(
          "card",
          "Also open a result card",
          "Open a card with a Copy button when the text is ready.",
          "guide",
          true,
        ),
      ),
      h(
        CustomSection,
        { key: "auto", title: "Automatic" },
        h(SelectRow, {
          key: "auto",
          title: "Auto-transcribe",
          subtitle: "Transcribe new incoming voice messages by themselves.",
          icon: "bell",
          value: nameOf(AUTO_MODES, s.auto || "off").replace(" only", ""),
          last: true,
          onPress: () =>
            pick(
              "Auto-transcribe",
              "VTAuto",
              AUTO_MODES,
              s.auto || "off",
              (v) => {
                setSetting("auto", v);
                redraw();
              },
            ),
        }),
      ),
      h(
        CustomSection,
        {
          key: "history",
          title: "History",
          footer:
            "Up to " +
            MAX_TRANSCRIPTS +
            " transcripts are kept so they are still there after a restart.",
        },
        toggle(
          "saveTranscripts",
          "Remember transcripts",
          "Keep transcripts after closing the app.",
          "store",
          false,
          (v) => {
            if (v) persist();
            else setSetting("transcripts", []);
          },
        ),
        h(CustomAction, {
          key: "clear",
          title: "Clear transcripts (" + transcripts.size + ")",
          icon: "trash",
          danger: true,
          secondary: true,
          compact: true,
          disabled: !transcripts.size && !busy.size,
          onPress: () => {
            cancelRequests();
            const ids = Array.from(transcripts.values());
            transcripts.clear();
            setSetting("transcripts", []);
            ids.forEach((t) => refreshRow(t.channelId, t.id));
            redraw();
            toast("Transcripts cleared");
          },
        }),
      ),
      guide,
      h(
        Design.Text,
        {
          style: {
            fontSize: 12,
            textAlign: "center",
            marginTop: 1,
            opacity: 0.7,
          },
        },
        "Voice Messages to Text " + BUILD,
      ),
    );
  }

  /* ---- lifecycle ---- */
  function initializeAfterHydration() {
    if (!loadRequested || initialized) return;
    initialized = true;
    const s = cfg();
    const defaults = {
      provider: DEFAULT_SERVER ? "server" : "groq",
      serverUrl: "",
      model: "whisper-large-v3-turbo",
      language: "auto",
      inline: true,
      card: false,
      auto: "off",
      saveTranscripts: true,
    };
    const missing = {};
    for (const k of Object.keys(defaults))
      if (s[k] === undefined) missing[k] = defaults[k];
    if (Object.keys(missing).length)
      settingsStore.useStore.getState().updateSettings(missing);
    loadSaved();
    const bridge = {
      getTranscript: (id) =>
        loadRequested ? transcripts.get(String(id))?.text : undefined,
      handlesInline: (id) =>
        loadRequested &&
        renderReady &&
        cfg().inline !== false &&
        transcripts.has(String(id)),
    };
    globalThis.__valencedVoiceTranscriptBridge = bridge;
    unpatches.push(() => {
      if (globalThis.__valencedVoiceTranscriptBridge === bridge)
        delete globalThis.__valencedVoiceTranscriptBridge;
    });
    if (!patchRender())
      toast(
        "Voice Messages to Text: could not find the message list, text on voice messages is unavailable",
      );
    if (!patchActionSheet())
      toast("Voice Messages to Text: could not add the menu entry");
    unpatches.push(
      onFluxEventDispatched("MESSAGE_CREATE", (event) => {
        onCreate(event);
        return event;
      }),
    );
  }
  function onLoad() {
    loadRequested = true;

    const store = settingsStore.useStore;
    if (store.getState()._hasHydrated) {
      initializeAfterHydration();
      return;
    }
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
    cancelRequests();
    const old = Array.from(transcripts.values());
    transcripts.clear();
    old.forEach((t) => refreshRow(t.channelId, t.id));
    renderReady = false;
    if (hydrationUnsubscribe) {
      hydrationUnsubscribe();
      hydrationUnsubscribe = null;
    }
    initialized = false;
    for (const t of timers.splice(0)) clearTimeout(t);
    for (const u of unpatches.splice(0)) {
      try {
        u();
      } catch (_) {}
    }
    if (renderUnpatch) {
      try {
        renderUnpatch();
      } catch (_) {}
      renderUnpatch = null;
    }
    closeSheet();
    transcripts.clear();
    busy.clear();
    partsCache = null;
  }

  return { onLoad, onUnload, settings: Settings };
})();

export const useSettings = settingsStore.useStore;
export default implementation;
