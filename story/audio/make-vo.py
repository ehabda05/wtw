"""Generate the voiceover lines for the demo video.

    python story/audio/make-vo.py            # Microsoft neural voice via edge-tts (free, no key)
    ELEVENLABS_API_KEY=... python story/audio/make-vo.py --elevenlabs [voice_id]

Reads story/audio/vo-lines.json, writes story/audio/vo/<id>.mp3 and story/audio/vo-durations.json
(id -> seconds). story/render/audio.mjs places the lines on the timeline and mixes them with the
sound design. Keys are read from the environment only and never printed.
"""
import asyncio
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "vo"
OUT.mkdir(exist_ok=True)
spec = json.loads((HERE / "vo-lines.json").read_text(encoding="utf-8"))
use_eleven = "--elevenlabs" in sys.argv


def ffprobe_duration(path: Path) -> float:
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    )
    return float(r.stdout.strip())


def eleven(line: dict, path: Path) -> str:
    """ElevenLabs TTS. Voice and model come from vo-lines.json "eleven" (overridable by ELEVENLABS_VOICE_ID /
    ELEVENLABS_MODEL or a voice id argument); falls back down the model list if the account cannot use one."""
    key = os.environ.get("ELEVENLABS_API_KEY")
    if not key:
        sys.exit("ELEVENLABS_API_KEY is not set")
    cfg = spec.get("eleven", {})
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    voice = args[0] if args else os.environ.get("ELEVENLABS_VOICE_ID") or cfg.get("voice_id", "EXAVITQu4vr4xnSDxMaL")
    models = [os.environ.get("ELEVENLABS_MODEL") or cfg.get("model", "eleven_v4")] + list(cfg.get("fallback_models", []))
    last = None
    for model in models:
        # v3/v4 take stability as a preset (0 creative, 0.5 natural, 1 robust); older models take the full range.
        settings = {"stability": 0.5, "similarity_boost": 0.85, "speed": cfg.get("speed", 1.0), "use_speaker_boost": True}
        if not model.startswith("eleven_v3") and not model.startswith("eleven_v4"):
            settings = {"stability": 0.45, "similarity_boost": 0.8, "style": 0.3, "speed": cfg.get("speed", 1.0)}
        body = json.dumps({"text": line["text"], "model_id": model, "voice_settings": settings}).encode()
        req = urllib.request.Request(
            f"https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=mp3_44100_128",
            data=body, headers={"xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg"},
        )
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                path.write_bytes(r.read())
            return model
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:200]
            last = f"{model}: HTTP {e.code} {detail}"
            if e.code in (400, 401, 402, 403, 404, 422):
                continue
            raise
    sys.exit(f"ElevenLabs refused every model ({last})")


async def edge(line: dict, path: Path) -> None:
    import edge_tts
    tts = edge_tts.Communicate(line["text"], spec.get("voice", "en-US-AndrewMultilingualNeural"), rate=spec.get("rate", "+0%"))
    await tts.save(str(path))


async def main() -> None:
    durations = {}
    used = None
    for line in spec["lines"]:
        path = OUT / f"{line['id']}.mp3"
        if use_eleven:
            used = eleven(line, path)
        else:
            await edge(line, path)
        durations[line["id"]] = round(ffprobe_duration(path), 3)
        print(f"{line['id']}  {durations[line['id']]:5.2f}s  {line['text']}")
    if used:
        print(f"model used: {used}")
    (HERE / "vo-durations.json").write_text(json.dumps(durations, indent=2) + "\n", encoding="utf-8")
    print(f"total speech {sum(durations.values()):.1f}s  ->  {HERE / 'vo-durations.json'}")


asyncio.run(main())
