package app.dariuss.voicetotext;

import app.valenced.plugins.PluginBuilder;
import app.valenced.plugins.PluginScope;
import de.robv.android.xposed.XC_MethodHook;
import de.robv.android.xposed.XposedBridge;
import kotlin.Unit;
import kotlin.jvm.functions.Function1;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Map;
import java.util.WeakHashMap;
import java.util.concurrent.ConcurrentHashMap;

/** Android-only adjustment of our own native embeds. The shared JS stays platform-independent. */
public final class TranscriptSpacing {
    private static final String PREFIX = "dariuss-voice-transcript:";
    private static final Map<Object, Snapshot> modified = new WeakHashMap<>();
    private static final Map<String, Method> methods = new ConcurrentHashMap<>();
    private static Field[] textFields;
    private static XC_MethodHook.Unhook hook;
    private static volatile boolean active;
    private static int descriptionId, spacerId, fieldsId;

    public static PluginBuilder getPlugin() {
        PluginBuilder builder = new PluginBuilder();
        builder.start(new Function1<PluginScope, Unit>() {
            public Unit invoke(PluginScope context) { install(context.getClassLoader()); return Unit.INSTANCE; }
        });
        builder.stop(new Function1<PluginScope, Unit>() {
            public Unit invoke(PluginScope context) { dispose(); return Unit.INSTANCE; }
        });
        return builder;
    }

    private static void install(ClassLoader loader) {
        try {
            // Verified against Discord 352.6 (352206); the manifest restricts this build family.
            Class<?> view = loader.loadClass("q9.q");
            Method setter = null;
            for (Method method : view.getDeclaredMethods()) {
                Class<?>[] types = method.getParameterTypes();
                if (types.length > 30 && types[1].getName().equals("n7.c")) {
                    if (setter != null) throw new IllegalStateException("Ambiguous native embed setter");
                    setter = method;
                }
            }
            if (setter == null) throw new IllegalStateException("Native transcript spacing is unavailable on this Discord build");
            ArrayList<Field> strings = new ArrayList<>();
            for (Field field : setter.getParameterTypes()[1].getDeclaredFields()) {
                if (field.getType() == String.class) { field.setAccessible(true); strings.add(field); }
            }
            textFields = strings.toArray(new Field[0]);
            active = true;
            hook = XposedBridge.hookMethod(setter, new XC_MethodHook() {
                protected void beforeHookedMethod(MethodHookParam parameter) {
                    Snapshot saved;
                    synchronized (modified) { saved = modified.remove(parameter.thisObject); }
                    if (saved != null) restore(parameter.thisObject, saved);
                }
                protected void afterHookedMethod(MethodHookParam parameter) {
                    if (!active || parameter.hasThrowable() || !owns(parameter.args[1])) return;
                    try { compact(parameter.thisObject); }
                    catch (Throwable error) { active = false; XposedBridge.log("Voice Messages To Text: native spacing unavailable: " + error); }
                }
            });
        } catch (Throwable error) {
            active = false;
            XposedBridge.log("Voice Messages To Text: " + error);
        }
    }

    private static boolean owns(Object embed) {
        if (embed == null || textFields == null) return false;
        try {
            for (Field field : textFields) {
                String value = (String) field.get(embed);
                if (value != null && value.startsWith(PREFIX)) return true;
            }
        } catch (Throwable ignored) { }
        return false;
    }

    private static Object call(Object target, String name, Class<?>[] types, Object... arguments) throws Exception {
        String key = target.getClass().getName() + "#" + name;
        Method method = methods.get(key);
        if (method == null) {
            method = target.getClass().getMethod(name, types);
            method.setAccessible(true);
            methods.put(key, method);
        }
        return method.invoke(target, arguments);
    }
    private static Object call(Object target, String name) throws Exception { return call(target, name, new Class<?>[0]); }
    private static Object child(Object view, int id) throws Exception { return call(view, "findViewById", new Class<?>[]{int.class}, id); }
    private static void visibility(Object view, int value) throws Exception { call(view, "setVisibility", new Class<?>[]{int.class}, value); }
    private static void height(Object view, int value) throws Exception {
        Object params = call(view, "getLayoutParams");
        params.getClass().getField("height").setInt(params, value);
        // Resolve by the actual declared base parameter, rather than a concrete layout subclass.
        String key = view.getClass().getName() + "#setLayoutParams";
        Method setter = methods.get(key);
        if (setter == null) {
            for (Method candidate : view.getClass().getMethods()) {
                if (candidate.getName().equals("setLayoutParams") && candidate.getParameterTypes().length == 1) { setter = candidate; methods.put(key, setter); break; }
            }
        }
        if (setter != null) setter.invoke(view, params);
    }
    private static void resolveIds(Object view) throws Exception {
        if (descriptionId != 0) return;
        Object resources = call(view, "getResources");
        String packageName = (String) call(call(view, "getContext"), "getPackageName");
        Class<?>[] arguments = {String.class, String.class, String.class};
        int description = (Integer) call(resources, "getIdentifier", arguments, "description", "id", packageName);
        int spacer = (Integer) call(resources, "getIdentifier", arguments, "spacer", "id", packageName);
        int fields = (Integer) call(resources, "getIdentifier", arguments, "fields_top_wrap", "id", packageName);
        if (description == 0 || spacer == 0 || fields == 0) throw new IllegalStateException("Native transcript views were not found");
        descriptionId = description; spacerId = spacer; fieldsId = fields;
    }
    private static void compact(Object view) throws Exception {
        resolveIds(view);
        Object description = child(view, descriptionId), spacer = child(view, spacerId), fields = child(view, fieldsId);
        if (description == null || spacer == null || fields == null) return;
        Snapshot snapshot = new Snapshot(
            (Boolean) call(description, "getIncludeFontPadding"),
            call(spacer, "getLayoutParams").getClass().getField("height").getInt(call(spacer, "getLayoutParams")),
            (Integer) call(fields, "getVisibility"));
        // Save before changing anything, so even partial failures can be restored on recycling.
        synchronized (modified) { modified.put(view, snapshot); }
        call(description, "setIncludeFontPadding", new Class<?>[]{boolean.class}, false);
        if ((Integer) call(fields, "getChildCount") == 0) visibility(fields, 8);
        Object metrics = call(call(view, "getResources"), "getDisplayMetrics");
        float density = metrics.getClass().getField("density").getFloat(metrics);
        height(spacer, Math.max(1, Math.round(4 * density)));
    }
    private static void restore(Object view, Snapshot snapshot) {
        try {
            Object description = child(view, descriptionId), spacer = child(view, spacerId), fields = child(view, fieldsId);
            if (description != null) call(description, "setIncludeFontPadding", new Class<?>[]{boolean.class}, snapshot.fontPadding);
            if (spacer != null) height(spacer, snapshot.spacerHeight);
            if (fields != null) visibility(fields, snapshot.fieldsVisibility);
        } catch (Throwable error) { XposedBridge.log("Voice Messages To Text: could not restore native spacing: " + error); }
    }
    private static void dispose() {
        active = false;
        if (hook != null) { hook.unhook(); hook = null; }
        synchronized (modified) {
            for (final Map.Entry<Object, Snapshot> entry : modified.entrySet()) {
                final Object view = entry.getKey();
                final Snapshot saved = entry.getValue();
                try { call(view, "post", new Class<?>[]{Runnable.class}, new Runnable() { public void run() { restore(view, saved); } }); }
                catch (Throwable error) { XposedBridge.log("Voice Messages To Text: native cleanup: " + error); }
            }
            modified.clear();
        }
        // Method handles contain no view instances; keep them for posted restoration work.
    }
    private static final class Snapshot {
        final boolean fontPadding;
        final int spacerHeight, fieldsVisibility;
        Snapshot(boolean padding, int height, int visibility) { fontPadding = padding; spacerHeight = height; fieldsVisibility = visibility; }
    }
}
