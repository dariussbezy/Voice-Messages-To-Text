# Voice Messages To Text

> Valenced test repository. The combined catalog is available from [dariussbezy's Plugins](https://github.com/dariussbezy/dariussbezy-Plugins).

Read Discord voice messages as text, with the transcript displayed **below the voice message**.

**Version: 1.0.1-beta**

## Installation

In Valenced, open **Plugins → Advanced → Repository URL**, paste this URL and add the repository:

```text
https://raw.githubusercontent.com/dariussbezy/Voice-Messages-To-Text/main/index.json
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

For transcript translation and fallback language detection, update Quick Translate from [its repository](https://github.com/dariussbezy/dariussbezy-Plugins) and restart Discord after updating both plugins.

The package includes a small Android spacing module for Discord 352.6. Restart Discord after updating so the native adjustment loads. The shared script continues to work without this Android-specific adjustment.

## Privacy

Transcribing sends the voice message's audio URL to the selected transcription service. Enabling automatic mode sends qualifying incoming voice messages automatically. The service downloads the audio to process it; its availability and limits apply.

If the transcription service does not supply a language and Quick Translate is enabled, up to 2,000 characters of transcript text are sent to Google for language detection. This request creates no translated message or translation history entry. Service errors or a disabled/missing Quick Translate can still leave the language unavailable.

Your Groq key and remembered transcripts are stored in Valenced's local plugin settings. The key is sent only to Groq. Turning off **Remember transcripts** removes saved history while retaining transcripts in memory for the current session. **Clear transcripts** also cancels pending transcriptions.

Sources are in [`js`](plugins/VMTT/js). The installable package is in the repository [pool](pool).
