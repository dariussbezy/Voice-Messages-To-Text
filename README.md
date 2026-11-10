# Voice Messages To Text

Read Discord voice messages as text, with the transcript displayed **below the voice message**.

**Version: 1.0.0-beta**

## Installation

In Valenced, open **Plugins → Advanced → Repository URL**, paste this URL and add the repository:

```text
https://raw.githubusercontent.com/dariussbezy/Voice-Messages-To-Text/refs/heads/main/VMTT/index.json
```

Find **Voice Messages To Text**, select **beta**, install it and restart Discord.

## Features

- Long-press a voice message and choose **Transcribe voice message**.
- Read the transcript below the audio player without replacing the original message.
- Use the built-in free server without an API key, or your own Groq key.
- Choose automatic language detection or select a language manually.
- With Groq, choose Whisper large v3 turbo or Whisper large v3.
- Open a compact transcript card, copy the text, transcribe again or remove the transcript.
- Completion notifications include the detected or manually selected language. If the transcription service omits it, an enabled, updated Quick Translate identifies it through a language-only Google request.
- Reduced empty space beneath transcript text on Android, including when a translation is shown.
- Choose services, languages and automatic modes in matching rounded selection sheets.
- Translate transcripts with Quick Translate when its current beta is installed and enabled. The translated text stays below the voice message too.
- Optionally transcribe new incoming voice messages in DMs or all chats; automatic mode is off by default.
- Optionally remember up to 200 transcripts between restarts, or clear them in settings.
- Two concurrent transcriptions at most, a bounded queue, request timeouts and cancellation when the plugin stops.

## Usage

Open the plugin settings to choose a service and test the connection. For Groq, create a key at [console.groq.com/keys](https://console.groq.com/keys) and paste it into **API key**.

Long-press a voice message to transcribe it. Once it is ready, long-press again for transcript and translation actions. Enable **Also open a result card** if you prefer a separate reading view.

For transcript translation and fallback language detection, update Quick Translate from [its repository](https://github.com/dariussbezy/Quick-Translate) and restart Discord after updating both plugins.

The package includes a small Android spacing module for Discord 352.6. Restart Discord after updating so the native adjustment loads. The shared script continues to work without this Android-specific adjustment.

## Privacy

Transcribing sends the voice message's audio URL to the selected transcription service. Enabling automatic mode sends qualifying incoming voice messages automatically. The service downloads the audio to process it; its availability and limits apply.

If the transcription service does not supply a language and Quick Translate is enabled, up to 2,000 characters of transcript text are sent to Google for language detection. This request creates no translated message or translation history entry. Service errors or a disabled/missing Quick Translate can still leave the language unavailable.

Your Groq key and remembered transcripts are stored in Valenced's local plugin settings. The key is sent only to Groq. Turning off **Remember transcripts** removes saved history while retaining transcripts in memory for the current session. **Clear transcripts** also cancels pending transcriptions.

Sources are in [`plugins/VMTT`](./plugins/VMTT). The installable package remains in [`VMTT`](./VMTT).

## Repository structure

Sources use the [official Valenced plugin template](https://github.com/Valenced/valenced-plugin-template/tree/9a4f9187137a75d86fe552d0e594889a6e6fd7e5). The implementation is in [`plugins/VMTT/js`](plugins/VMTT/js), with shared configuration and the official plugin CLI at the repository root. `./gradlew packageAllPlugins` packages the plugin; `npm run publish:local` prepares the pool and both repository indexes. The `VMTT/index.json` installation URL remains supported. Artifacts stay on `main` and the beta channel.

Android sources are in `plugins/VMTT/src/main/java`. Native compilation uses the real Valenced API through Gradle, with compile-only host dependencies. Set `READ_PACKAGES_TOKEN` for the manual packaging workflow, as described by the official template.

Install development dependencies with `bun install --frozen-lockfile` before running the root scripts. The compiler and SDK revisions are pinned in `package.json`.

This template migration preserves the existing native JAR byte for byte. Fresh native compilation requires access to the Valenced SDK package; GitHub Packages returned HTTP 401 with the credentials available during migration.
