"""Explicit, repeatable download of local voice models. Run from any directory."""
import argparse
import hashlib
import json
import shutil
from pathlib import Path

from huggingface_hub import HfApi, hf_hub_download

ROOT = Path(__file__).resolve().parents[2]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--size", choices=["tiny", "base", "small"], default="tiny")
    parser.add_argument("--include-second-voice", action="store_true")
    parser.add_argument("--separate-whisper", action="store_true", help="Download only Whisper into whisper-<size>.")
    args = parser.parse_args()
    models = ROOT / "models"
    models.mkdir(exist_ok=True)
    api = HfApi()
    manifest = []
    whisper_dir = f"whisper-{args.size}" if args.separate_whisper else "whisper"
    sources = [
        (f"Systran/faster-whisper-{args.size}", {
            name: f"{whisper_dir}/{name}" for name in
            ["config.json", "model.bin", "tokenizer.json", "vocabulary.txt"]
        }),
        ("rhasspy/piper-voices", {
            "it/it_IT/paola/medium/it_IT-paola-medium.onnx": "voice.onnx",
            "it/it_IT/paola/medium/it_IT-paola-medium.onnx.json": "voice.onnx.json",
            "it/it_IT/paola/medium/MODEL_CARD": "PIPER_MODEL_CARD.txt",
        }),
    ]
    if args.separate_whisper:
        sources = sources[:1]
    elif args.include_second_voice:
        sources.append(("rhasspy/piper-voices", {
            "it/it_IT/riccardo/x_low/it_IT-riccardo-x_low.onnx": "riccardo.onnx",
            "it/it_IT/riccardo/x_low/it_IT-riccardo-x_low.onnx.json": "riccardo.onnx.json",
            "it/it_IT/riccardo/x_low/MODEL_CARD": "RICCARDO_MODEL_CARD.txt",
        }))
    for repo, files in sources:
        info = api.model_info(repo, files_metadata=True)
        revision = info.sha
        metadata = {file.rfilename: file for file in info.siblings}
        for filename, destination in files.items():
            print(f"Downloading {repo}: {filename}", flush=True)
            cached = Path(hf_hub_download(repo, filename, revision=revision,
                                         cache_dir=str(models / ".cache")))
            with cached.open("rb") as source:
                digest = hashlib.file_digest(source, "sha256").hexdigest()
            lfs = metadata[filename].lfs
            expected = lfs.sha256 if lfs else None
            if expected and digest != expected:
                raise RuntimeError(f"Checksum mismatch: {filename}")
            target = models / destination
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(cached, target)
            manifest.append({"repository": repo, "revision": revision,
                             "file": filename, "local": destination, "sha256": digest})
    manifest_path = models / (f"manifest-{whisper_dir}.json" if args.separate_whisper else "manifest.json")
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"Voice models ready in {models}")


if __name__ == "__main__":
    main()
