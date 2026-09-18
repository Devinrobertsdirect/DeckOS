#!/usr/bin/env python3
"""
make-blank-cursor.py — build the transparent cursor the kiosk needs.

A Nobi runs labwc on Wayland, and the compositor draws the mouse pointer itself.
No amount of `cursor: none` in the page can touch it: CSS governs the pointer
only while Chromium owns it, and the pointer a compositor draws before anything
claims it sits there regardless — in practice, parked squarely on the robot's
eye. It is the single most out-of-character thing on the screen.

The fix is to give the compositor a cursor theme whose cursors are invisible,
which ~/.config/labwc/environment already asks for:

    XCURSOR_THEME=blank
    XCURSOR_PATH=$HOME/.icons:/usr/share/icons

That configuration shipped in July with a theme directory containing 37
symlinks and NOT ONE REAL FILE — every one pointed at `left_ptr`, which was
never created. labwc found the theme, failed to load a cursor from it, and fell
back to the system arrow. It looked configured, which is exactly why nobody
caught it for two months.

So this writes the file they all point at: a 1x1 fully transparent Xcursor,
offered at every nominal size a compositor is likely to ask for so the lookup
always resolves to something real.

    python3 make-blank-cursor.py                 # writes into ~/.icons/blank/cursors
    python3 make-blank-cursor.py /tmp/left_ptr   # or wherever

Takes effect when the compositor next starts, because a cursor theme is read at
startup — so a reboot, not a kiosk restart.
"""
import os
import struct
import sys

# Xcursor's image chunk type, from xcursor.h.
IMAGE_TYPE = 0xFFFD0002
# The sizes a compositor might ask for. Any miss falls back to the system
# cursor, which is the whole bug, so err on the side of offering more.
SIZES = (16, 24, 32, 48, 64, 96, 128)


def transparent_cursor() -> bytes:
    """A 1x1 fully transparent image at each nominal size."""
    chunks = [
        # header, type, subtype (the nominal size), version, w, h, xhot, yhot, delay
        struct.pack("<9I", 36, IMAGE_TYPE, size, 1, 1, 1, 0, 0, 0)
        + struct.pack("<I", 0x00000000)  # one ARGB pixel, alpha 0
        for size in SIZES
    ]
    header = struct.pack("<4sIII", b"Xcur", 16, 0x00010000, len(chunks))

    toc = b""
    pos = len(header) + len(chunks) * 12
    for size, chunk in zip(SIZES, chunks):
        toc += struct.pack("<3I", IMAGE_TYPE, size, pos)
        pos += len(chunk)

    return header + toc + b"".join(chunks)


def main() -> int:
    target = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser(
        "~/.icons/blank/cursors/left_ptr"
    )
    os.makedirs(os.path.dirname(target), exist_ok=True)
    blob = transparent_cursor()
    with open(target, "wb") as fh:
        fh.write(blob)
    print(f"wrote {target} ({len(blob)} bytes, {len(SIZES)} sizes)")

    # Every other cursor name in the theme is a symlink to this one, so a theme
    # that was never built gets built here too rather than half-existing.
    cursors = os.path.dirname(target)
    made = 0
    for name in (
        "default", "arrow", "pointer", "hand", "hand1", "hand2", "text", "xterm",
        "ibeam", "crosshair", "cross", "move", "fleur", "grab", "grabbing",
        "progress", "wait", "watch", "left_ptr_watch", "not-allowed", "no-drop",
        "help", "question_arrow", "all-scroll", "col-resize", "row-resize",
        "n-resize", "s-resize", "e-resize", "w-resize", "ne-resize", "nw-resize",
        "se-resize", "sw-resize", "ew-resize", "ns-resize", "nesw-resize",
        "nwse-resize", "sb_h_double_arrow", "sb_v_double_arrow",
    ):
        link = os.path.join(cursors, name)
        if os.path.lexists(link):
            continue
        os.symlink("left_ptr", link)
        made += 1
    if made:
        print(f"linked {made} cursor names to it")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
