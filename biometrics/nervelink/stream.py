"""NERVELINK — biosignal streaming service.

Reads EEG/ECG/EMG frames via BrainFlow and broadcasts them as JSON over a
WebSocket on :8090 so the Atlas dashboard (and anything else) can subscribe.

Defaults to BrainFlow's SyntheticBoard, so it runs with zero hardware:

    python stream.py                     # synthetic signals on ws://0.0.0.0:8090
    python stream.py --board-id 0        # OpenBCI Cyton (serial port required)
    python stream.py --board-id 1 --serial-port COM3   # Ganglion
    python stream.py --board-id 38       # Muse 2 (BLE)
    python stream.py --list-boards       # print the id table

Frame format (one JSON object per message):

    {
      "type": "bio.frame",
      "board": "SYNTHETIC_BOARD",
      "sampling_rate": 250,
      "ts": 1760000000.123,
      "channels": [[...], [...]],   # per-EEG-channel sample windows
      "channel_count": 8
    }

NOT medical software. See README.md for the capability framing and disclaimer.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import time

log = logging.getLogger("nervelink")

WS_PORT = 8090
WINDOW_S = 0.25          # emit ~4 frames/sec

# Friendly names for the boards we care about (BrainFlow BoardIds values).
KNOWN_BOARDS = {
    -1: "SYNTHETIC_BOARD",
    0: "CYTON_BOARD (OpenBCI, 8ch EEG/EMG/ECG, serial)",
    1: "GANGLION_BOARD (OpenBCI, 4ch, BLE/serial)",
    2: "CYTON_DAISY_BOARD (OpenBCI, 16ch, serial)",
    38: "MUSE_2_BOARD (Muse 2, 4ch EEG, BLE)",
    39: "MUSE_S_BOARD (Muse S, 4ch EEG, BLE)",
    22: "MUSE_2016_BOARD (Muse 2016, BLE)",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="NERVELINK biosignal streamer")
    parser.add_argument("--board-id", type=int, default=-1,
                        help="BrainFlow board id (default -1 = SyntheticBoard)")
    parser.add_argument("--serial-port", default="",
                        help="Serial port for Cyton/Ganglion dongles, e.g. COM3 or /dev/ttyUSB0")
    parser.add_argument("--mac-address", default="",
                        help="MAC address for BLE boards (Muse, Ganglion BLE)")
    parser.add_argument("--port", type=int, default=WS_PORT,
                        help=f"WebSocket port to serve on (default {WS_PORT})")
    parser.add_argument("--list-boards", action="store_true",
                        help="Print known board ids and exit")
    return parser.parse_args()


def open_board(board_id: int, serial_port: str, mac_address: str):
    """Create and start a BrainFlow session. Returns (board, sampling_rate, eeg_channels)."""
    from brainflow.board_shim import BoardShim, BrainFlowInputParams

    params = BrainFlowInputParams()
    if serial_port:
        params.serial_port = serial_port
    if mac_address:
        params.mac_address = mac_address

    BoardShim.disable_board_logger()
    board = BoardShim(board_id, params)
    board.prepare_session()
    board.start_stream()

    sampling_rate = BoardShim.get_sampling_rate(board_id)
    eeg_channels = BoardShim.get_eeg_channels(board_id)
    return board, sampling_rate, eeg_channels


async def broadcast_loop(board, board_id: int, sampling_rate: int,
                         eeg_channels: list[int], clients: set) -> None:
    """Pull windows from the board ring buffer and fan out to all WS clients."""
    board_name = KNOWN_BOARDS.get(board_id, f"BOARD_{board_id}")
    samples_per_window = max(1, int(sampling_rate * WINDOW_S))

    while True:
        await asyncio.sleep(WINDOW_S)
        data = board.get_board_data()  # everything since last call, then clears
        if data.shape[1] == 0:
            continue
        window = data[:, -samples_per_window:]
        frame = json.dumps({
            "type": "bio.frame",
            "board": board_name.split(" ")[0],
            "sampling_rate": sampling_rate,
            "ts": time.time(),
            "channel_count": len(eeg_channels),
            "channels": [window[ch].round(3).tolist() for ch in eeg_channels],
        })
        dead = set()
        for ws in clients:
            try:
                await ws.send(frame)
            except Exception:  # noqa: BLE001 — client gone
                dead.add(ws)
        clients -= dead


async def serve(args: argparse.Namespace) -> None:
    import websockets

    clients: set = set()

    async def handler(ws) -> None:
        clients.add(ws)
        log.info("client connected (%d total)", len(clients))
        try:
            await ws.wait_closed()
        finally:
            clients.discard(ws)
            log.info("client disconnected (%d total)", len(clients))

    board, sampling_rate, eeg_channels = open_board(
        args.board_id, args.serial_port, args.mac_address)
    log.info("board %s streaming at %d Hz, %d channels",
             KNOWN_BOARDS.get(args.board_id, args.board_id),
             sampling_rate, len(eeg_channels))

    try:
        async with websockets.serve(handler, "0.0.0.0", args.port):
            log.info("NERVELINK serving on ws://0.0.0.0:%d", args.port)
            await broadcast_loop(board, args.board_id, sampling_rate,
                                 eeg_channels, clients)
    finally:
        board.stop_stream()
        board.release_session()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    args = parse_args()
    if args.list_boards:
        for board_id, name in sorted(KNOWN_BOARDS.items()):
            print(f"{board_id:>4}  {name}")
        return
    try:
        asyncio.run(serve(args))
    except KeyboardInterrupt:
        log.info("stopped")


if __name__ == "__main__":
    main()
