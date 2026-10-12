#!/usr/bin/env python3
"""Render an HTML file to a PNG with headless Microsoft Edge (or Chrome).

Used by the mww-frontend skill to look at UI without running the Tauri app.

    python screenshot.py page.html out.png [--width 1100] [--height 700] [--scale 2] [--wait 1500]

Build the UI first (`npm run build`) and put dist/assets/*.css next to the HTML so the
real Tailwind output styles the harness.
"""
import argparse
import os
import subprocess
import sys
from pathlib import Path


def find_browser() -> str:
    names = [
        r"Microsoft\Edge\Application\msedge.exe",
        r"Google\Chrome\Application\chrome.exe",
    ]
    for var in ("ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"):
        base = os.environ.get(var)
        if not base:
            continue
        for name in names:
            path = Path(base) / name
            if path.exists():
                return str(path)
    sys.exit("Neither Microsoft Edge nor Google Chrome was found.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("html", help="HTML file to render")
    parser.add_argument("out", help="PNG file to write")
    parser.add_argument("--width", type=int, default=1100)
    parser.add_argument("--height", type=int, default=700)
    parser.add_argument("--scale", type=float, default=2.0, help="device scale factor; 2 is sharp")
    parser.add_argument(
        "--wait",
        type=int,
        default=1500,
        help="milliseconds of page time to run before the capture, so enter animations have finished",
    )
    args = parser.parse_args()

    html = Path(args.html).resolve()
    out = Path(args.out).resolve()
    if not html.exists():
        sys.exit(f"Not found: {html}")
    out.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        find_browser(),
        "--headless",
        "--disable-gpu",
        "--hide-scrollbars",
        f"--force-device-scale-factor={args.scale}",
        f"--window-size={args.width},{args.height}",
        f"--virtual-time-budget={args.wait}",
        f"--screenshot={out}",
        html.as_uri(),
    ]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False, timeout=60)
    if not out.exists() or out.stat().st_size == 0:
        sys.exit("The screenshot was not created.")
    print(out)


if __name__ == "__main__":
    main()
