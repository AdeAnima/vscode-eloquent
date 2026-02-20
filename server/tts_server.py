"""
Lightweight HTTP server wrapping F5-TTS-MLX for local text-to-speech synthesis.
Stays warm to avoid cold-start latency per request.
"""

import argparse
import json
import sys
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

# Lazy-loaded after arg parsing
generate_fn = None
ref_audio_path = None
ref_text = None


def load_model(quantize: str | None = None):
    """Import and warm up the F5-TTS-MLX model."""
    global generate_fn

    from f5_tts_mlx.generate import generate

    generate_fn = generate

    # Warm up with a short synthesis to load all weights
    print("[tts_server] Warming up model...", flush=True)
    generate(text="Ready.", output_path=None)
    print("[tts_server] Model warm-up complete.", flush=True)


class TTSHandler(BaseHTTPRequestHandler):
    """Handle POST /synthesize requests."""

    def do_POST(self):
        if self.path != "/synthesize":
            self.send_error(404, "Not found")
            return

        content_length = int(self.headers.get("Content-Length", 0))
        if content_length == 0 or content_length > 1_000_000:
            self.send_error(400, "Invalid content length")
            return

        body = self.rfile.read(content_length)
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            self.send_error(400, "Invalid JSON")
            return

        text = data.get("text", "").strip()
        output_path = data.get("output_path")

        if not text:
            self.send_error(400, "Missing 'text' field")
            return

        if not output_path:
            self.send_error(400, "Missing 'output_path' field")
            return

        # Validate output_path is in temp directory
        output_resolved = os.path.realpath(output_path)
        import tempfile

        tmp_dir = os.path.realpath(tempfile.gettempdir())
        if not output_resolved.startswith(tmp_dir):
            self.send_error(400, "output_path must be in system temp directory")
            return

        try:
            kwargs = {"text": text, "output_path": output_path}

            if ref_audio_path:
                kwargs["ref_audio_path"] = ref_audio_path
            if ref_text:
                kwargs["ref_text"] = ref_text

            generate_fn(**kwargs)

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(
                json.dumps({"status": "ok", "output_path": output_path}).encode()
            )
        except Exception as e:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ok"}).encode())
        else:
            self.send_error(404, "Not found")

    def log_message(self, format, *args):
        """Redirect logs to stderr to keep stdout clean for status signals."""
        print(f"[tts_server] {args[0]}", file=sys.stderr, flush=True)


def main():
    global ref_audio_path, ref_text

    parser = argparse.ArgumentParser(description="F5-TTS-MLX HTTP server")
    parser.add_argument("--port", type=int, default=18230)
    parser.add_argument("--ref-audio", type=str, default="")
    parser.add_argument("--ref-text", type=str, default="")
    parser.add_argument("--quantize", type=str, default=None, choices=["4", "8"])
    args = parser.parse_args()

    if args.ref_audio:
        ref_audio_path = args.ref_audio
    if args.ref_text:
        ref_text = args.ref_text

    # Load model (this can take a while on first run — downloads weights)
    load_model(args.quantize)

    server = HTTPServer(("127.0.0.1", args.port), TTSHandler)

    # Signal readiness to the VS Code extension (stdout is monitored)
    print("READY", flush=True)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        print("[tts_server] Shut down.", flush=True)


if __name__ == "__main__":
    main()
