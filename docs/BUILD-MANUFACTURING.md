# Atlas Robot — Build & Manufacturing Guide

> Companion to **DeckOS Atlas** (design docs ATL-HW-001 / ATL-ID-001). Everything you need to
> take the Atlas companion robot from files to a working, durable machine: the high-reliability
> PCB spec (with exact PCBWay form values), where to design it, 3D printing the shell, the
> Blender + CAD workflow, the full bill of materials, and the end-to-end manufacturing flow.
>
> Target: Raspberry Pi 5 (8GB) brain, 282 mm cylindrical body, two-wheel differential drive.

---

# PCB Fabrication Spec — exact PCBWay values for a high-reliability Atlas HAT

This is the fab-and-assembly spec for **ATL-HW-001**, the Pi 5 carrier/HAT. The board is a genuinely mixed beast — a 62 MHz SPI face, I2S audio, a fistful of I2C sensors, *and* a 12 V/5 A motor rail plus a 19 V dock input — all baking continuously at ~78 °C inside a sealed shell with vibration from the drivetrain. Every value below is chosen for the thing you asked for: a board that does not fail in the field.

## Where to design it (online)

| Tool | Verdict for this board |
|---|---|
| **KiCad 9** (free desktop, cross-platform) | **Primary recommendation.** Best free 4-layer + physical-stackup/impedance manager, clean Gerber X2 + IPC-2581 export PCBWay ingests directly, zero vendor lock-in. Not browser-based, but it is the correct tool for a mixed-signal controlled-impedance board. |
| **EasyEDA Pro** (browser + desktop, free) | **Best true "online" pick.** Runs in the browser, huge integrated LCSC library (saves you drawing footprints), exports standard Gerbers you send to PCBWay. It is JLCPCB's tool but is not locked to them for fab. Weaker constraint/stackup control than KiCad. |
| **Flux.ai** (browser-native, ~$20/mo) | Good if you want real-time collaboration + AI copilot for library work. Caveat: it gets sluggish at higher layer counts/density and has thin stackup control — acceptable for a 4-layer HAT, not ideal. |
| **Altium 365** ($3.5k–7.5k/seat/yr, Windows-only) | Overkill and overpriced for a single HAT. Skip. |

Design in **KiCad 9** if you can; if you specifically want in-browser, use **EasyEDA Pro**. Either way you hand PCBWay a Gerber X2 + drill + IPC-356 netlist + a stackup drawing.

## PCBWay Advanced-PCB form — exact selections

| Field | Recommended value | Why |
|---|---|---|
| **PCB Type** | Through-hole board (standard, plated-through vias) — **not HDI** | No fine-pitch BGA or laser-microvia density here; the biggest part is an SSOP/QFN. HDI blind/buried vias add cost and reliability risk you don't need. |
| **Board Spec (standard)** | **IPC-6012 Class 3** | Class 3 = "high reliability, continued performance critical." It forces tighter annular ring, better registration, and thicker hole-wall copper — exactly what a continuously-hot, vibrating robot board needs. |
| IATF16949 / ISO13485 | **No (do not select)** | Those are automotive/medical QMS certifications for regulated supply chains. They add cost and paperwork with zero technical benefit to a maker robot. Class 3 gives you the reliability; the QMS certs give you an audit trail you don't need. |
| **Board Configuration** | Single pieces (proto) → **Panel by Supplier** for the assembled run | Single for bare-board bring-up. For PCBA, a supplier V-scored/tabbed panel feeds the pick-and-place and cuts assembly setup cost. |
| **Layers** | **4** (see stackup below) | 4 layers buys you a solid unbroken ground plane under the 62 MHz SPI and I2S — clean return paths, controlled impedance, and thermal spreading. **6** is only justified if the 12 V power pours plus high-speed break-out won't route on a crowded HAT footprint; it roughly doubles cost. Start at 4, promote to 6 only if the router forces it. |
| **Material / Tg** | **Tg170 FR-4, halogen-free** (e.g. Shengyi S1150G-class / ITEQ IT-180A-class) | Sealed box at ~78 °C continuous. Tg must sit far above operating temp — Tg140 is too close, inviting resin softening and z-axis expansion that cracks plated holes over thermal cycles. Tg170 gives margin + higher Td. Halogen-free is secondary (cleaner outgassing in a sealed shell); if PCBWay can't stock HF at Tg170, keep **Tg170** — the Tg matters more than the HF. |
| **Thickness** | **1.6 mm** | Standard HAT mechanical: mates the 40-pin stacking header height, gives rigidity against connector-insertion and vibration, and yields the most reliable 0.3 mm PTH aspect ratio (5.3:1). Thinner hurts PTH reliability and stiffness. |
| **Min track/spacing** | Declare **5/5 mil (0.127 mm)**; design to **≥6 mil** signal, **≥20 mil** power | Declare 5/5 so the fab holds tolerance for the tightest QFN/SSOP escape, but route everything you can at 6–8 mil. Wider = higher etch yield and fewer defects. Never push the fab's floor on a reliability board. |
| **Min hole size** | **0.3 mm** (0.20 mm only if a specific via-in-pad forces it) | Bigger drills plate more reliably. 0.3 mm drill / 0.6 mm pad on a 1.6 mm board is a robust, low-aspect-ratio via. No part here needs sub-0.25 mm. |
| **Solder mask color** | **Green (glossy)** | The board is hidden inside the shell, so pick for *inspection*, not looks: green has the most mature process, tightest mask registration, and the best AOI/manual-inspection contrast. Matte black looks premium but hides defects, runs thinner over traces, and absorbs heat — a bad trade on a hot board. |
| **Silkscreen** | **White**, both sides as needed | High contrast on green. Include ref-designators, pin-1 dots, connector polarity, **fuse/E-STOP labels**, board rev, `ATL-HW-001`, and a date-code box. |
| **Surface finish** | **ENIG (immersion gold)** | Dead-flat coplanar finish for the fine-pitch SSOP/QFN and dense 0402s (HASL's bumps hurt fine-pitch), plus excellent shelf life through multiple rework/reflow cycles. **ENEPIG** (adds palladium) is for wire-bonding or repeated gold-finger insertion — you have neither, so it's wasted money. **HASL** is cheaper but uneven and thermally harsher. |
| **Gold / nickel thickness** | **Au 3U″ (µin) / Ni 120–200U″** | 2U″ is the IPC-4552 solderability minimum; 3U″ adds corrosion/shelf-life margin for a board that may sit in inventory and see humidity. Don't chase 5U″+ — excess gold embrittles solder joints. |
| **Finished copper weight** | **Outer 2 oz (70 µm); inner 1 oz** | The 12 V/5 A drive rail plus motor current (≈14 W nominal, 32 W peak, N20 stall spikes) and heat-spreading in a sealed box. 2 oz outer halves trace resistance/temp-rise vs 1 oz. Inner planes stay 1 oz. (2 oz needs the relaxed spacing you already designed to.) |
| **Hole-copper (barrel) plating** | **25 µm (1 mil) minimum** | IPC-6012 **Class 3 mandates ≥25 µm** average PTH copper (Class 2 allows 20 µm). Thicker barrels survive the board's continuous thermal cycling + vibration. This selection is coupled to the Class 3 choice above. |
| **Impedance control** | **Yes — 50 Ω single-ended on SPI0 only** (SCLK/MOSI/DC nets); everything else uncontrolled | At 62 MHz with sub-2 ns edges the SPI face is borderline; controlling it forces PCBWay onto a defined stackup and hands you an impedance report — cheap insurance. There is **no differential impedance to control**: the camera is MIPI CSI-2 but it plugs into the **Pi's own CSI FPC connector, not this HAT**, so no 100 Ω pairs route on your board. If cost-sensitive, you may skip it *provided* SPI0 runs short and unbroken over the L2 ground plane. |
| **Via process (fill/cap)** | **Resin-filled & capped (plated-over) for via-in-pad**; tented (mask) for all other vias | Via-in-pad without fill wicks solder → voids and opens. Resin-fill + copper cap gives a flat solderable pad and blocks wicking under the TB6612FNG thermal pad and any QFN pad. **Copper-filled (electroplated) vias** are the premium upgrade specifically under the **TB6612 power/thermal pad** for best heat + current path — worth it there if budget allows. |
| **Edge plating / castellations** | **No (neither)** | This HAT mates through the 40-pin header, not an edge connector or castellated module join. Both options add cost for nothing here. |
| **Beveling / edge connector** | **No** | No gold-finger card edge. |
| **UL marking** | **Off for prototype; On for any production run** | All PCBWay FR-4 is already UL94V-0 laminate. The UL logo + fab ID mark only matters for traceability/compliance if you productize — add it then. |
| **Peelable solder mask** | **None** | Only needed to protect pads through wave/selective soldering. Your board is SMT-reflow + hand-soldered THT, so it's unnecessary. (Exception: apply peelable over the **pogo-pin dock pads** if you consign the board and want them pristine through assembly.) |
| **Final inspection / reports (request all free ones)** | **Flying-probe/E-test 100% (always) + Microsection + Solderability + Thermal-stress + Impedance report** | Microsection verifies the Class-3 plating thickness & annular ring you're paying for; solderability catches ENIG "black pad"; thermal-stress (float/shock) proves the PTHs survive the hot box; impedance report closes the loop on the SPI0 control. These are free/near-free at PCBWay — take them on a reliability board. |

## Recommended 4-layer stackup (1.6 mm)

Asymmetric build: put a **thin dielectric between L1 and L2** so the 62 MHz SPI microstrip references ground closely and 50 Ω is achievable at a sane trace width.

| Layer | Name | Copper | Purpose |
|---|---|---|---|
| **L1 (Top)** | Signal + placement | 2 oz | All SMT parts; high-speed SPI0, I2S, I2C routed here referenced to L2; short power stubs into the planes. |
| — | Prepreg ≈ **0.10–0.15 mm** | — | Thin dielectric → tight SPI0 ground reference + microstrip impedance control. |
| **L2 (Inner)** | **Ground plane** | 1 oz | Solid, unbroken GND — the primary return/reference for every fast net on L1 and the hub of the star ground. Do not slit it. |
| — | Core ≈ **1.065 mm** | — | Mechanical bulk; gives the 1.6 mm finished thickness. |
| **L3 (Inner)** | **Power plane** | 1 oz | Split pours: 5 V compute, 3.3 V, and a fat 12 V drive island; reference plane for L4. Keep the split boundaries away from L4 fast nets. |
| — | Prepreg ≈ **0.10–0.15 mm** | — | Close reference for bottom-side routing/power. |
| **L4 (Bottom)** | Signal + power pours | 2 oz | 12 V / motor high-current pours and any spill-over routing, referenced to L3. **Keep the Pi-facing side clear of tall parts** for Pi 5 clearance. |

> Let PCBWay's impedance engineers confirm final dielectric heights and hand you the exact trace width for 50 Ω (typically ~7–9 mil microstrip on a ~0.1 mm dielectric). Attach this stackup as a drawing in the order notes and check **"Custom stackup."**

## Six DFM notes for this mixed 12 V-power + logic board

1. **Creepage/clearance on the 12 V and 19 V-dock nets.** IPC-2221 electrical minimums are tiny, but for a vibrating high-current board don't design to them: hold **≥0.5 mm (20 mil)** conductor-to-conductor on the 12 V rail and **≥1.0 mm (40 mil)** on the 19 V dock input, reverse-polarity diode node, and E-STOP switch terminals. Add copper-free gaps/slots under the E-STOP and dock-input switch nodes, and keep these nets away from mounting holes.

2. **Copper pour + thermal relief.** Flood L1/L4 with GND and stitch to L2 on a **~2–3 mm grid of 0.3 mm vias**, densest around the fan, TB6612, and the two bucks, to move heat in the sealed 78 °C box. Use **4-spoke thermal relief (0.3–0.4 mm spokes)** on hand-soldered THT/connector GND pads so the iron can wet them; use a **solid, relief-free** connection on high-current motor/12 V pads and the TB6612 thermal pad for lowest resistance and best heat sinking.

3. **Star ground / plane discipline.** Tie the **power ground** (TB6612/motor return) to the **quiet ground** (BNO085 IMU, VL53L1X ToF, INA219 sense, MAX98357A audio) at a **single point** near the 5 V/GND entry. Keep H-bridge return current out of the sensor ground return. Never route a fast net across an L3 power-plane split; if unavoidable, drop a stitching cap/via at the crossing to give the return a path.

4. **Motor-noise isolation.** Corral the TB6612 + 12 V rail + N20 motor connectors into one board region; put the LCD SPI, I2S mics, and analog sensors on the far side with a **ground moat/guard between them**. Snub the motor terminals (RC or ferrite + bulk), **guard the encoder IRQ lines** (GPIO16/17/22/23) with adjacent ground, and route the 20 kHz PWM (GPIO12/13) and DIR (GPIO5/6) well clear of high-impedance sensor and audio nets.

5. **Decoupling.** A **100 nF 0402 hard against every IC power pin** (Pi header 3.3 V/5 V feeds, TB6612 VCC *and* VM, MAX98357A, each sensor), plus bulk: **100–220 µF low-ESR at the TB6612 VM (12 V)** input to absorb motor di/dt, 10–22 µF at each buck output, 10 µF at the LCD. Via straight to plane from each cap; keep the power/return loop short and wide. **Kelvin-sense the INA219 shunt** (4-terminal connection) or your current reading will be garbage.

6. **Fuse / E-STOP / protection.** Put the hardware E-STOP in series in the 12 V rail on **2 oz copper ≥60–100 mil (or pour)** with the clearance from note 1. At the 19 V dock input, after the reverse-polarity device, add a **fuse (or resettable poly-fuse) + a TVS** for pogo-pin hot-plug transients; prefer a **P-FET ideal-diode** over a plain Schottky for reverse protection (lower drop, less heat). Put **flyback TVS/diodes across the motor terminals**. Size the reverse-polarity device for full charge current + margin and heatsink it into pour. RC-filter the **E-STOP sense (GPIO26)** and **DOCK sense (GPIO27)** so motor noise can't trip them.

## Assembly (PCBA) order block

| Item | Recommendation | Why |
|---|---|---|
| **Turnkey vs Kitted vs Combo** | **Combo (turnkey + partial consignment)** | Let PCBWay **source** the jellybean/standard parts (all passives, TB6612FNG, MAX98357A, INA219, connectors, headers, diodes/TVS, buck ICs) from LCSC — fast and cheap. **Consign** the spec-critical / authenticity-sensitive parts: **BNO085** (buy genuine from Bosch/DigiKey to dodge clones) and any single-source IC. |
| **Off-board parts** | Do **not** place: the **3.1″ 480×480 round LCD** (mounts on the face, wired via FFC/JST), N20 motors, 18650 pack/BMS, and the Camera Module 3 (plugs into the Pi CSI, not the HAT). | These connect by cable/connector; the fab populates only the HAT's own SMT + through-hole. |
| **Assembly sides** | **Top-side SMT only (single reflow)**; 40-pin stacking header + JST/pogo/E-STOP through-hole = **hand or selective solder** | One stencil, one reflow = cheaper and higher yield, and it keeps the **Pi-facing bottom clear** for mechanical clearance to the Pi 5. Only push small passives to the bottom if density truly forces it. |
| **Stencil** | **Frameless (foil) laser-cut stainless, ~0.12 mm (5 mil), electropolished** | Frameless is the right call for proto/low volume (PCBWay includes it); framed is for production stencil printers. **Window-pane the TB6612 thermal-pad aperture to ~50–60% area** so the part doesn't float or tombstone on a solder flood. |
| **Consign vs let-fab-source** | **Consign:** round LCD (off-board), BNO085, any brand-critical IC. **Fab sources:** passives, TB6612FNG, MAX98357A, INA219, connectors/headers, TVS/diodes, buck regulators. | Fab-sourcing jellybeans is cheapest and fastest; consigning the few authenticity/lead-time-critical parts protects reliability. |

Sources: [PCBWay Advanced-PCB order form](https://www.pcbway.com/HighQualityOrderOnline.aspx), [PCBWay — Via Filled with Copper](https://www.pcbway.com/helpcenter/ordering_parameter_instruction/Via_Filled_with_Copper.html), [PCBWay — Via in Pad](https://www.pcbway.com/helpcenter/ordering_parameter_instruction/Via_in_Pad.html), [PCBWay — Impedance Control](https://www.pcbway.com/pcb_prototype/Impedance_Control.html), [Best PCB Design Software 2026 (Flux)](https://www.flux.ai/p/blog/best-pcb-design-software-2026)

---

# PCB Design — schematic, layout, and where to design it online

This is the board that turns a pile of modules into Atlas. Because the shell is sealed, runs continuously near thermal throttle (~78 °C), and every module "swaps behind a HAL," the PCB stack has to be **serviceable, quiet, and manufacturable to a reliability standard** — not just electrically correct. The recommendations below are tuned for a PCBWay order at IPC Class 2/3, with exact fab-form values at the end.

---

## 1. Board partitioning — one HAT, or a split stack?

**Recommendation: split into three boards, not one monolithic HAT.** ATL-HW-001 calls the carrier "a Pi 5 HAT stack," and the right physical realization is:

| Board | What lives on it | Where it mounts | Why it's separate |
|---|---|---|---|
| **A — Power/Motor board** ("base board") | 4S pack input, BMS interface + fuel gauge, 12 V/5 A buck, 5 V/5 A buck, TB6612FNG, INA219 shunts, hardware E-stop in 12 V rail, dock 19 V input + reverse-polarity + ideal-diode ORing, motor/encoder/battery connectors | Low, over the axle next to the battery | The 12 V motor rail is the noisiest thing in the robot: 20 kHz PWM into inductive N20s with high di/dt on start/stall. You do **not** want that current loop, its ground bounce, or its radiated field sharing copper with a 62 MHz display SPI bus or an IMU. Keeping it on its own board near the battery also shortens the fat high-current traces. |
| **B — Logic HAT+** | 40-pin header, ID EEPROM, I²C1 sensor bus (BNO085, TCA9548A, INA219/BMS pass-through), I²S mic + amp front-end, fan driver, E-STOP/DOCK sense conditioning, inter-board connectors to A and C | On the Pi 5 40-pin header | This is the only board that must obey the HAT+ mechanical spec. Keeping it "logic only" means it's low-current, low-heat, and can be a clean 4-layer board with solid planes. |
| **C — Face board** | Round LCD FPC/connector, backlight LED driver + PWM dimming, series/damping resistors on the SPI + DC/RST lines, 3.3 V local bypass | Directly behind the smoked-glass dome / round LCD, at the crown | The display is the one high-speed net that wants the shortest possible controlled run. Put its connector millimeters from the panel, not 200 mm down a ribbon to a HAT. It's also the module most likely to change per Mark edition, so it should unplug on its own. |

**Interconnect:** Board A ↔ Board B over a single keyed ribbon (2.0 mm IDC or a JST-PH header) carrying: 5 V compute rail (up), motor control (PWM GPIO12/13, DIR GPIO5/6), the four encoder IRQs (GPIO16/17/22/23), E-STOP sense (GPIO26), DOCK sense (GPIO27), and the shared I²C1 for INA219 + fuel gauge. Board B ↔ Board C over a short shielded flat cable carrying SPI0 (GPIO8-11), DC/RST (GPIO24/25), 3.3 V, 5 V (for backlight boost), and grounds — put a ground wire between every signal in that cable.

> **Why not one HAT:** a single board forces the 12 V/motor return current under the Pi and the display bus. Even with careful planes you'll fight EMI on the ToF ranging and IMU, and a display glitch or a shorted motor lead takes out the whole board instead of a $30 module. The split also matches the "every module swaps behind a HAL" design intent and the two-thumbscrew serviceability goal.

---

## 2. Raspberry Pi 5 HAT+ rules (Board B)

Design Board B to the **HAT+ specification** ([spec PDF](https://datasheets.raspberrypi.com/hat/hat-plus-specification.pdf), [design guide](https://github.com/raspberrypi/hats/blob/master/designguide.md), [mechanical repo](https://github.com/raspberrypi/hats)). Pull the exact outline/hole DXF+STEP from the repo rather than eyeballing — the numbers below are the canonical full-size HAT drawing:

| Item | Value | Why / note |
|---|---|---|
| Board outline | **65.0 × 56.0 mm** | Standard full-HAT footprint; HAT+ *allows* other sizes but this fits the Pi 5 keep-outs cleanly and gives you room. |
| Corner radius | **R3.0 mm** all four corners | Per drawing; avoids sharp corners fouling standoffs. |
| Mounting holes | **4 × Ø2.75 mm** (for M2.5), centers at (3.5, 3.5), (61.5, 3.5), (3.5, 52.5), (61.5, 52.5) mm → **58.0 × 49.0 mm** spacing | Non-plated or plated-and-grounded; put grounded copper annulus if you tie chassis GND here. Use **M2.5 nylon or steel standoffs**; steel gives a chassis-ground path (decide deliberately). |
| GPIO connector | 2×20, 2.54 mm pitch, at the Pi datum | Use a **stacking/extended-height header** if anything on the Pi (fan, RTC) needs vertical clearance; otherwise a standard 8.5 mm SMT or THT 2×20. THT is more robust for a robot that vibrates — recommend THT with the tail clinched. |
| ID EEPROM | **CAT24C32** (or 24C32-class), 3.3 V, on **I²C0** = ID_SD **GPIO0 (pin 27)** / ID_SC **GPIO1 (pin 28)**, address **0x50**, with **3.9 kΩ pull-ups to 3V3** | Required for HAT+ autodetect. On HAT+ the EEPROM stores the **device-tree overlay name**; firmware then loads the overlay from `/boot/firmware/overlays`. Write it with `eepromutils`/`eepmake`. Do **not** hang your application sensors on ID_SD/ID_SC — that bus is for the EEPROM only. |
| 3.3 V I/O only | **Pi 5 GPIO is 3.3 V and NOT 5 V-tolerant on any pin** | Every signal crossing to the Pi must be 3.3 V. TB6612 logic, encoders, ToF, IMU, I²S all run at 3.3 V here, so you're fine — but if any module is 5 V (some encoder breakouts), level-shift it (e.g., TXB0108/TXS0102 for bidir I²C-safe parts, or a simple FET translator). |
| HAT+ STANDBY | Board must tolerate **5 V rail present while 3.3 V rail is off** | Don't back-feed the 3.3 V rail from anything that's alive in standby, and don't let leakage hold a bus up. |
| **Powering the Pi through the header** | You feed 5 V *up* into the header 5 V pins from Board A's 5 V/5 A buck | This bypasses the Pi's USB-C input protection/e-fuse. The PMIC then can't see a PD contract, so it may cap downstream USB current. Set `usb_max_current_enable=1` in `config.txt` (or set the PSU current in EEPROM). Keep the 5 V feed fused and add bulk cap right at the header. |

**Keep-outs on the Pi 5 (leave copper *and* component height clear):**

- **Active Cooler collision:** the official Pi 5 Active Cooler is too tall to sit under a HAT. Plan for a **low-profile heatsink + your chassis fan (GPIO4 PWM)** instead, or a stacking header tall enough to clear it. Given the sealed, near-throttle thermal case, design the airflow deliberately — don't assume the HAT can coexist with the tall cooler.
- **PCIe FPC connector** (right edge) — HAT+ defines a cut-out; keep it clear so you can still use NVMe/PCIe later.
- **Dual MIPI CSI/DSI FPC connectors** (left edge) — your Camera Module 3 Wide plugs in here via the Pi CSI connector; the HAT must not block it. Route the camera flex up the mast *outside* the board footprint.
- **Fan header** (4-pin JST-SH between HDMI and header) and **UART/debug + RTC battery connectors** — keep clearances per the drawing.
- **USB-C + micro-HDMI** heights along the front edge.

Start from **[MisterHW/RPi5-HATplus](https://github.com/MisterHW/RPi5-HATplus)** — it already has the HAT+ outline plus the PCIe and dual-CSI cut-outs drawn.

---

## 3. Per-subsystem design notes

### TB6612FNG motor stage (Board A, 12 V)
- **Bulk + local decoupling:** ≥ **470 µF electrolytic** (low-ESR, 25 V) on VM (12 V) right at the driver, plus **0.1 µF + 10 µF ceramic** on VM and on VCC (logic 3.3 V). The stall/reversal current step is what corrupts everything else — kill it locally.
- **Flyback/clamp:** the TB6612 has internal body diodes, but for inductive N20s add a **local RC snubber** or a Schottky across each output pair if you see ringing; keep the motor-current loop (VM → driver → motor connector → GND) tight and on the same layer with a ground pour underneath.
- **PWM 20 kHz on GPIO12/13, DIR on GPIO5/6:** 20 kHz is above audible and easy for the TB6612 — good. Series **~33 Ω** on PWM/DIR gate-ish lines to tame edges/EMI into the ribbon.
- **Current sense:** put the **INA219** on a high-side shunt in the **12 V drive rail** (measures total motor draw; matches the ~14 W motor budget) and optionally a second on the pack. INA219 default **0x40** (address-strap the two if you use two). Kelvin-connect the shunt.
- **Encoders:** the four IRQ lines (GPIO16/17/22/23) are noise-sensitive — route them away from VM, add **1 nF to GND + 1 kΩ series** at the Pi end, and pull up to 3.3 V.

### TCA9548A I²C mux → 5× VL53L1X ToF (Board B/A)
- Mux at **0x70** on I²C1 (GPIO2/3, 400 kHz). Each VL53L1X keeps its **default 0x29** because it lives on its own downstream mux channel — this avoids XSHUT re-addressing gymnastics.
- Still **break out XSHUT and GPIO1 per sensor**: XSHUT lets you hard-reset a hung ToF; **GPIO1 is the interrupt/ranging-ready** output (wire to spare GPIO or poll). Pull XSHUT up; drive low to disable.
- Because the 5 ToF sit around the crown/skirt on cables, put **each sensor's SDA/SCL/VDD/GND/XSHUT/GPIO1 on its own JST-SH 6-pin** and keep the mux physically central so the five stubs are short and roughly equal.

### BNO085 IMU (Board B)
- Use **I²C1 at 0x4A** (or 0x4B) for simplicity — SPI is faster but the BNO085's I²C is fine for orientation and frees SPI0 for the display. **If** you ever see the known BNO08x I²C clock-stretch issues, that's the one reason to move it to SPI; design a 0 Ω/DNP option so you *can* jump to SPI without a respin.
- **Break out PS0/PS1** (interface select), **nRESET**, **BOOTn**, and the **INT/HOST_INT** line to GPIO. Tie PS0/PS1 for I²C per datasheet, pull nRESET/BOOTn to their run states, and route INT to a Pi GPIO so you use interrupt-driven reads, not polling. Bypass with 0.1 µF close to the part.

### I²S mic array + MAX98357A (Board B)
- Shared **BCLK GPIO18** and **LRCLK/FS GPIO19** fan out to both the mics and the amp. **DIN GPIO20** = mics → Pi; **DOUT GPIO21** = Pi → MAX98357A.
- **MAX98357A channel select:** it's set by a resistor on the **SD_MODE** pin — pick **(L+R)/2**, Left, or Right; for a mono 3 W/4 Ω speaker use **(L+R)/2** so you never drop a channel. Bypass VDD with 10 µF + 0.1 µF; the amp's output filter is internal (Class-D, filterless) but keep the speaker leads twisted and short.
- **Correctness callout — 4 mics vs. one data line:** the Pi's classic I²S/PCM block exposes **one data-in (GPIO20)**. Standard I²S MEMS mics pack **two per data line** (one on the L, one on the R half-frame via each mic's SEL pin). So GPIO20 alone gives you **2 mics, not 4**. For the 4-mic ring you must do one of: **(a)** bring a **second PCM RX** out on other GPIOs via a device-tree overlay on the Pi 5's RP1 (extra wiring, and it won't be the 18-21 block), **(b)** use **PDM mics into a hardware aggregator/decimator** (e.g., a small codec) that emits a single TDM/I²S stream, or **(c)** a **4-channel TDM mic ADC**. Cleanest for a fixed product is **(b) or (c)** — decide this before you place the mic connectors, because it changes the front-end. Route BCLK/LRCLK as a matched pair, keep them off the motor ribbon, and add series **22-33 Ω** on the clocks.

### Round LCD "face" (Board C, SPI0 @ 62 MHz)
- **Verify the panel's real interface before you commit the connector.** Many "480×480 round SPI" modules are **ST7701S RGB panels that use SPI only for init** and then need an 18/16-bit **parallel RGB (DPI)** bus for pixels — which the Pi 5 can't spare here. For a genuine single-lane-SPI face, choose a controller that streams pixels over SPI/QSPI (e.g., ST77916/SPD2010-class). At 62 MHz single-lane, a full 480×480×16-bit frame is ~3.7 Mbit ≈ **~16 fps full-screen**, plenty for a face that mostly updates the **eyes** with partial-window writes.
- Route **SCLK/MOSI/MISO (GPIO8-11)** as a short, tight group with a continuous ground under them; series **~22 Ω** on SCLK/MOSI at the source to control edges. **DC/RST = GPIO24/25.** Keep the whole SPI run < ~100 mm; that's the whole reason the face is its own board.
- **Backlight:** drive the LED string from a small **constant-current boost** with a **PWM dimming input** off a spare GPIO/PWM (or a dedicated pin), not straight off 3.3 V — the "eyes" want smooth brightness and the smoked dome eats light.

### Power tree (Board A)
```
Dock 19 V ──[reverse-pol Schottky]──┐
                                    ├─[ideal-diode ORing]──► pack/charge node
4S2P pack 14.8 V ─[BMS 4S 30A]──────┘
        │  (fuel gauge on I²C1)
        ▼
   [E-STOP — hardware, in the 12 V feed]
        │
   ┌────┴───────────────┐
   ▼                    ▼
[Buck 12 V/5 A]     [Buck 5 V/5 A]
   │  (drive rail)      │  (compute rail)
   ▼                    ▼
INA219 → TB6612 → N20s   Pi 5 (via header) + display + audio
```
- **Ideal-diode ORing** between dock 19 V and the pack so charging and running coexist without back-driving the dock; the **reverse-polarity Schottky** protects against a mis-inserted pogo contact (accept its Vf drop or use a P-FET ideal diode for efficiency).
- **E-stop in the 12 V rail only** (kills motors, keeps compute alive so Atlas can say why it stopped) — sense the switch state on **GPIO26** with a pulled-up, RC-filtered input.
- **INA219 on the 12 V drive rail** (see motor stage). Put the **fuel gauge** (BMS) and INA219 on the shared I²C1 that rides the A↔B ribbon.
- Give each buck its own input/output bulk caps and a solid ground plane; separate the **motor ground return** from the **compute/analog return** and join them at a **single star point** near the pack negative. This one choice does more for ToF/IMU cleanliness than anything else.

---

## 4. Connectors and strain relief

All **JST parts lock** — use them everywhere on a robot that vibrates and has a rotating skirt. Match series to current and cable gauge:

| Net | Connector | Why |
|---|---|---|
| 4S pack main (up to ~7-10 A peak) | **XT30** (or JST-VH 3.96 mm) | High current, low resistance, keyed. Don't push this through PH. |
| BMS balance leads | Vendor 5-pin balance (JST-XH 2.5 mm) | Standard for 4S balance. |
| Dock 19 V input | **JST-VH** or 2-pos screw terminal | Robust, higher current/voltage. |
| N20 motor power (2-pin, < 1 A) | **JST-PH 2.0 mm** | Locking, right-sized; add RTV dab (see below). |
| Encoders (VCC/GND/A/B) | **JST-SH 1.0 mm 4-pin** or PH 4-pin | Small, keyed; SH for tight crown routing. |
| VL53L1X ToF (SDA/SCL/VDD/GND/XSHUT/GPIO1) | **JST-SH 6-pin** | One clean cable per sensor. |
| I²S mics | **JST-SH** (per mic module) | Keeps clock/data pairs tidy. |
| A ↔ B inter-board | **2.0 mm keyed IDC ribbon** or JST-PH 2×N | Carries power + control; keying prevents mis-mate. |
| B ↔ C (display) | **Shielded FFC or JST-SH** with ground between signals | Short, quiet SPI run. |

**Strain relief (mandatory in a sealed, moving robot):**
- Add **PCB tie-down slots/anchors** next to every off-board connector and zip-tie a **service loop** so cable tension never pulls the housing.
- Put a **fillet of RTV/hot-melt** at the motor and battery connectors after final test.
- Use **right-angle connectors** where a cable exits toward the wheels/skirt so the cable doesn't fold at the shell.
- Keep connectors **off the board edge that faces moving parts**, and orient them so removing the one-part shell doesn't drag cables.

---

## 5. Where to design it online — tool comparison

| Tool | Runs where | Cost | Ordering / parts | Collab / AI | Best for THIS project |
|---|---|---|---|---|---|
| **KiCad 10** (10.0.4, Jun 2026) | Desktop (Win/mac/Linux) | Free, open | Vendor-neutral Gerber/IPC-2581/ODB++ → any fab incl. PCBWay; JLCPCB/LCSC libs available | Git-based collab (no live cursors); no built-in AI | **Primary — recommended.** No vendor lock-in, clean PCBWay-ready outputs, HAT+ template exists, 4-layer + impedance stackups, mature DFM. Best for a board you'll iterate and fab for reliability. |
| **EasyEDA Std / Pro** | Browser + desktop | Free | **Direct JLCPCB** parts + one-click order (can still export Gerbers for PCBWay) | Cloud projects, light collab | Only if you plan JLCPCB **assembly**; otherwise the JLC tie-in is a distraction when you're fabbing at PCBWay. |
| **Flux.ai** | Browser | Free tier + paid | Exports Gerbers/BOM for any fab | **Real-time collab + AI copilot** | Good **secondary** if you want browser access, live collaboration, and AI help placing/reviewing. |
| **Altium 365 / Autodesk Fusion Electronics** | Desktop + cloud | Paid (pro) | Pro outputs, any fab | Full cloud collab | Overkill/cost for a solo founder prototype; revisit if the team grows. |

**Recommendation for Atlas:** **KiCad 10 as primary**, optionally **Flux.ai** when you want browser access + AI review. Design all three boards in one KiCad project (three schematic sheets), fab at **PCBWay** with the values in §6. Rationale: your goal is a *guaranteed, durable* board fabbed at PCBWay — KiCad's neutral Gerbers + IPC-2581 give the fab the cleanest data, the HAT+ template removes the riskiest mechanical work, and you're never locked to one vendor's parts.

**Exact first-steps workflow:**
1. **Clone the template:** start Board B from **[MisterHW/RPi5-HATplus](https://github.com/MisterHW/RPi5-HATplus)**; import its outline + PCIe/CSI cut-outs. Confirm hole positions against the [official mechanical drawing](https://github.com/raspberrypi/hats).
2. **Schematic:** three hierarchical sheets — Power/Motor (A), Logic-HAT (B), Face (C). Place the ID EEPROM on ID_SD/ID_SC first so you don't forget it. Annotate + ERC.
3. **Assign footprints:** use manufacturer footprints (KiCad libs) or LCSC/JLCPCB parts; set the ground rules for the mux, INA219, and connector series now.
4. **Layout:** set the board outline from the template DXF, drop the 40-pin header on the datum, honor the Pi 5 keep-outs. Route order: **power/high-current first → display SPI → I²C/IO → everything else.** 4-layer stackup (SIG / GND / PWR / SIG) for B and A; 2-layer OK for C.
5. **DRC:** load PCBWay's rules (min 6/6 mil track/space, 0.3 mm drills — see §6) and run clean. Add impedance constraints only on nets that need them.
6. **Fab outputs:** Plot **Gerbers (RS-274X)** + **Excellon drill**, generate **BOM (CSV)** and **CPL/placement (.pos)** if you want assembly. Zip Gerbers+drill → upload to PCBWay → fill the form.

---

## 6. PCBWay order-form values (high-reliability preset)

Fill the pasted form as below. Values chosen for reliability first, cost second. Where boards differ, the split is called out ([PCBWay capabilities](https://www.pcbway.com/capabilities.html)).

| Form field | Set to | Why |
|---|---|---|
| Board type | **Single pieces** (panel the small Face board via "panel by PCBWay") | Face board is tiny; panelizing lowers per-unit handling. |
| Different design in panel | **1** | One design per order. |
| Size (X×Y) | **65 × 56 mm** (Logic HAT); enter each board's actual size | Matches HAT footprint; drives price tier. |
| Layers | **4** for Logic HAT (B) and Power board (A); **2** for Face (C) | Solid GND + power planes give clean return paths under 62 MHz SPI and quiet the 20 kHz motor rail. Face is simple. |
| Material | **FR-4** | Standard, reliable. |
| FR4-TG | **TG155** (TG170 if offered at similar cost) | Sealed shell runs ~78 °C continuously; higher Tg gives thermal-cycling margin over standard TG130-140. |
| Thickness | **1.6 mm** | HAT+ standard so standoffs/headers fit; mechanically robust. |
| Min track/spacing | **6 mil / 6 mil (0.15 mm)** | Well inside PCBWay's 4 mil floor → higher yield and reliability, lower cost than fine-line. |
| Min hole size | **0.3 mm** | Above the 0.15 mm minimum → robust plating, better reliability. |
| Solder mask | **Green** (or Matte Black if the board is ever visible) | Green is the most mature, highest-yield mask process. Pick black only for looks. |
| Silkscreen | **White** | Standard, legible. |
| Surface finish | **ENIG (immersion gold)** | Flat pads for fine-pitch QFN/connectors, best solderability, and corrosion resistance in a warm sealed enclosure — worth it over lead-free HASL for a reliability build. |
| Copper weight (outer) | **1 oz** for B/C; **2 oz** for Power board A | 2 oz on A carries the 12 V/5 A + motor current and spreads heat. |
| Via process | **Tented / plugged vias** | Prevents solder wicking and shorts under the dense HAT. |
| Impedance control | **No** for HAT/Power (keep SPI short); **only if** you run a long controlled-Z display cable | Short traces don't need it; don't pay for it unless a net requires it. Standard tolerance is ±10%. |
| Gold fingers / Castellated / Edge plating | **No** | Not used here. |
| Electrical test | **100% flying-probe / E-test** | Non-negotiable for reliability — catches opens/shorts. |
| Remove product No. | **Specify a location** (or Remove) | Keeps PCBWay's order number off critical silk. |
| Quantity | **10** (min useful prototype run) | Spares for the inevitable rework. |
| **Special-instructions / remarks box** | Type: **"IPC-A-600 Class 3; confirm stackup & impedance before production; no design changes without approval."** | Class 3 raises annular-ring/plating/inspection standards; the confirm-before-build note is your reliability insurance. |

Verify current fab rules at the [PCBWay capabilities page](https://www.pcbway.com/capabilities.html) at order time, and pull the exact HAT outline from the [official Raspberry Pi hats repo](https://github.com/raspberrypi/hats) before you generate Gerbers.

**Key reference links**
- HAT+ specification: https://datasheets.raspberrypi.com/hat/hat-plus-specification.pdf
- HAT design guide: https://github.com/raspberrypi/hats/blob/master/designguide.md
- HAT mechanical + repo: https://github.com/raspberrypi/hats
- KiCad HAT+ template: https://github.com/MisterHW/RPi5-HATplus
- PCBWay capabilities: https://www.pcbway.com/capabilities.html

---

## 3D Printing the shell and body

This is the part of the build where an hour of planning saves a week of reprints. The shell is one continuous arched dome, 282 mm tall × 180 mm dia, it lives a few millimeters from a Pi 5 that idles near 78 °C, and it has to look like "good paper" while snapping on and off by hand. Everything below is chosen around those four constraints: **heat, height, hand-feel, and finish.**

### 1. Material choice per part

| Part | Recommended material | Why this one | Avoid / notes |
|---|---|---|---|
| **Outer shell** (the dome, ONE part) | **ASA** (Polymaker PolyLite ASA or 3DO ASA), matte natural/bone. Premium alt: **SLS/MJF PA12** printed by a service. | ASA HDT is ~95–100 °C — it will not creep or soften sitting next to a 78 °C Pi, and it's genuinely UV-stable (won't yellow), which PETG and PLA are not. PolyLite ASA prints with a naturally matte, low-sheen face that already reads as bead-blasted paper and hides layer lines better than almost any other ASA. | **Do not use PETG for the shell.** Its HDT is only ~70–75 °C; in a sealed tower running at throttle it can slump or lose stiffness at the crown. **Never PLA** (~55 °C, and it embrittles in UV). |
| **Face dome** ("smoked glass" over the LCD) | **NOT FDM.** Either (a) **SLA clear resin** (Elegoo Saturn 4 Ultra 16K + a clear resin) polished to optical clarity and tinted, or (b) **off-the-shelf smoked polycarbonate camera dome** (the security-camera dome hemispheres sold in 60–90 mm dia). | FDM cannot make anything you can see through — layer lines scatter light. A tinted resin print or a PC camera dome gives the dark, glassy "one eye" look and PC survives the heat. | Acrylic (PMMA) domes are cheaper but scratch easily and are more brittle near heat; PC is the durable choice. See tinting methods in §5. |
| **Rubber skirt** (hides wheels) | **TPU 95A** (Polymaker PolyFlex TPU95 or SUNLU TPU) in matte black. Alt: an off-the-shelf rubber bumper/gasket ring cut to length. | 95A is flexible enough to absorb bumps and take the differential-drive scuffing, but stiff enough to print cleanly and hold a skirt profile. Matte black hides scuffs and reads as "rubber." | 85–90A prints poorly on Bowden setups and oozes; use direct-drive. If you don't want to print flexible, a slip-on silicone/EPDM bumper is a legitimate shortcut. |
| **Internal spine + module brackets** (behind the HAL) | **PETG** for general brackets; **PA-CF / PA6-CF** (Bambu PAHT-CF or Polymaker Fiberon PA6-CF) for the load-bearing spine and motor mounts. | These are hidden, so no UV/finish concern — you optimize purely for stiffness and dimensional stability. Carbon-filled nylon is dramatically stiffer and dimensionally stable at chassis temperatures, which keeps the drive geometry and encoder alignment true. PETG is fine and cheap for low-load brackets. | PA-CF needs a hardened steel nozzle and aggressive drying (see §3). Don't put ABS-family parts under continuous load next to the battery. |

**Why ASA over PA12-nylon for the shell (the real trade):** printed PA12 (via SLS/MJF at a service like Craftcloud/JLC/PCBWay) is the "guaranteed durable" dream — isotropic, no layer lines, a factory-matte nylon surface that is *exactly* the good-paper look with zero post-work, and it sidesteps the 282 mm height problem entirely because the service bed is huge. The catch is cost (a shell that size in MJF is typically $150–350 per part) and you can't iterate cheaply. **Recommendation: prototype the shell in ASA on your own printer; move the final "Mark edition" shells to MJF PA12 once the geometry is frozen.** That matches your edition model (editions differ only by finish + persona) — MJF gives you a repeatable, dyeable, identical shell per unit.

### 2. The 282 mm-tall problem

Most desktop beds are 220–256 mm in Z, so a 282 mm upright print is off the table on a Bambu P1S/X1C (256), Prusa MK4 (210), or any Ender-class 250. You have three real options.

**Option A — Buy into a 350 mm-class printer and print it in one piece (recommended if you're doing a run).**
A one-piece shell has no seams to hide, no glue creep, and no alignment error — for a "high-reliability, durable" build that's worth the printer. Current (mid-2026) enclosed machines that clear 282 mm in Z with a 180 mm footprint to spare:

| Printer | Build volume | Notes |
|---|---|---|
| **Creality K2 Plus** | 350 × 350 × 350 mm | True cube, enclosed, heated chamber — good for ASA. |
| **Sovol SV08** (Voron-based, Klipper) | 350 × 350 × 345 mm | Best value; add the enclosure kit for ASA. |
| **Qidi Plus 4 / Max 4** | 305 × 305 × 280 / 325 mm | Actively heated chamber (holds ~60–65 °C) — the strongest ASA machine here. Max 4 clears the height; verify Plus 4's 280 mm against your final Z. |
| **Bambu Lab H2D** | 350 × 320 × 325 mm | Fully enclosed CoreXY, plug-and-play calibration at size. |

An actively-heated chamber (Qidi) is the single biggest reliability upgrade for a tall ASA part — it kills the mid-height delamination that open printers get on ASA.

**Option B — Split into 2 sections along the hidden rear seam + internal collar (recommended if you keep your current printer).**
Split the dome once at roughly mid-height (~140 mm), landing the cut *inside the rear seam line* so it's already visually broken there. Design the join as:
- A **3–4 mm registration lip/collar** on the lower half that the upper half slides over (self-aligning, and it doubles the glue-bond surface area).
- **3× tapered alignment pins** (Ø5 mm, 8 mm long, 1° draft) at 120° so it can only assemble one way and can't rack.
- A separately-printed **internal PETG collar ring** epoxied across the seam on the inside — this is what actually carries the load; the outer joint is cosmetic.
- Bond with **methylene-chloride/acetone-family solvent weld** (ASA solvent-welds like ABS — it fuses to one material, stronger than glue) or, for PA12/PETG where solvent won't work, **methacrylate structural adhesive (e.g. 3M DP8005/Plexus)**.

**Option C — 3 shorter sections.** Only if your Z is truly small (~200 mm). More seams = more finishing work and more chances for a visible step; avoid unless forced.

**Recommendation:** if this is a product run, **Option A on a Qidi (heated chamber) or K2 Plus** — one-piece reliability with the fewest failure modes. If it's a one-off on gear you already own, **Option B, two-piece with an internal PETG collar**, hidden in the rear seam. Either way, keep the *face bezel* opening and the two thumbscrew bosses in the lower section so the precision features print flat and true.

### 3. Print settings per material

Values are a strong starting point for a 0.4 mm nozzle (use a **0.6 mm nozzle for the shell** — fewer perimeters for the same wall thickness, ~40% faster on a big part, and stronger layer bonding). Always fine-tune to your machine.

| Setting | ASA (shell) | PETG (brackets) | PA-CF (spine) | TPU 95A (skirt) |
|---|---|---|---|---|
| **Nozzle temp** | 250–260 °C | 235–245 °C | 285–300 °C | 220–230 °C |
| **Bed temp** | 95–100 °C | 80–85 °C | 90–110 °C | 40–50 °C |
| **Chamber** | Enclosed, 45–55 °C (heated ideal) | Not required | Enclosed | Not required |
| **Nozzle type** | Brass ok | Brass ok | **Hardened steel** (CF is abrasive) | Brass ok |
| **Filament drying** | 4 h @ 70 °C | 4 h @ 65 °C | **8–12 h @ 80 °C, print from dry box** | 6 h @ 55 °C |
| **Layer height** | 0.20 mm body / **0.12–0.16 mm face bezel** | 0.20 mm | 0.20 mm | 0.20 mm |
| **Walls / perimeters** | **4** (or 3 with 0.6 nozzle → ~1.8 mm wall) | 3–4 | 4 | 2–3 |
| **Infill** | **15% gyroid** | 15–20% gyroid | 25–30% gyroid | 8–12% gyroid |
| **Top/bottom layers** | 5 / 5 | 5 / 5 | 6 / 6 | 4 / 4 |
| **Print speed (walls)** | 80–120 mm/s (outer ~60) | 40–60 mm/s | 40–60 mm/s | **20–35 mm/s** |
| **Part cooling fan** | **5–20%** (low, prevents delam) | 30–50% | 0–20% | 30–50% |
| **Bed adhesion** | **5–8 mm brim + draft shield**, glue stick | Brim if tall | Brim, PEI + glue | Textured PEI, glue |

**Why these:** *Gyroid infill* gives near-isotropic stiffness in all directions for a shell that gets handled from every angle, and it prints without the "thunk" resonance of grid. *4 walls* is the structural minimum for a load-bearing shell that takes thumbscrew and magnet loads — at 0.6 mm nozzle that's ~1.8 mm of solid perimeter. *Low cooling on ASA* is counterintuitive but essential: too much fan is the #1 cause of layer cracking and warping on ASA, especially on a tall part. The *finer 0.12–0.16 mm layers on the face bezel* keep the smoked-dome bezel crisp so the "one eye" reads as a clean rim, not a stair-stepped ring.

**Orientation & supports for the curved dome:**
- **Print the shell upright, crown-up**, on its skirt opening. This puts layer lines running *around* the dome (they follow the silhouette, so they read as intentional turned-lathe rings, not defects) and keeps the crown's mic-ring/camera features as the last thing printed — no supports touching the visible dome exterior.
- The **crown overhang**: a dome that closes at the top self-supports up to ~50–55° from vertical, but the final cap flattens past that. Use **tree/organic supports** *interfacing only the inside* of the crown, or design a small "sacrificial dome-cap" seam. Never let supports contact the outer show surface — support scars are the hardest thing to sand out of a matte finish.
- The **face-dome bezel opening** prints as an overhang on the front; add a 45° chamfer or a printed-in-place bridge so it needs no support.
- ASA **must** run in an enclosure. On an open printer a 282 mm ASA shell *will* corner-lift and crack. If you can't enclose, that's your cue to switch that part to PETG-for-prototype-only or go MJF.

### 4. Magnetic mounts (the "two thumbscrews + magnets" system)

The thumbscrews carry the real retention load; the magnets do **alignment and the satisfying snap**, and hold the shell/face closed between the screws so nothing rattles. Use **N52 discs**: 6 × 3 mm for the shell perimeter, 6 × 2 mm for the lighter face dome.

**Pocket geometry (model these into the CAD, don't drill later):**

| Feature | Value | Why |
|---|---|---|
| Pocket diameter | **magnet Ø + 0.10–0.15 mm** → **6.10–6.15 mm** for a 6 mm magnet | FDM prints holes slightly undersize; this lands a light slip/press fit. Print a 3-hole test coupon (6.05/6.10/6.15) and pick the one that presses in with thumb pressure. |
| Pocket depth (press-fit) | **magnet thickness + 0.05 mm**, blind | Magnet sits flush or 0.05 mm proud so mating pairs actually touch. |
| Pocket depth (glued, recessed) | **magnet thickness + 0.20 mm** | Leaves room for a CA-glue bead under the magnet. |
| **Cap wall** (show side) | **0.6–0.8 mm** of solid material over the pocket | Hides the magnet completely behind the "good paper" surface — a blind pocket, never a through-hole. Thin enough that it barely costs pull force. |
| Wall around pocket | ≥ 1.5 mm | Keeps the boss from splitting on press-fit. |
| Lead-in chamfer | 0.3 mm × 45° at the pocket mouth | Guides the magnet in straight. |

**Press-fit vs CA glue:** press-fit alone can pop a magnet loose over hundreds of open/close cycles. **Best practice: press-fit for alignment, then a drop of thin CA wicked around the edge and a 5-minute cure.** Use CA, not epoxy — epoxy's thickness fights the tight fit.

**Polarity — build a jig, this is the classic disaster:** if two magnets go in backwards, the shell repels instead of holds. Make a tiny printed **polarity jig**: a block with one magnet epoxied in a marked "reference" pocket, and a shallow tray. Before every install, drop the loose magnet on the reference — the face that *sticks* is the face that goes *down into* the pocket (or up, pick one convention and mark it). Install all shell magnets one way and all mating (chassis-side) magnets the other. Dab the top face with a paint pen after seating so a mistake is visible before glue cures.

**Pull-force sizing (make it hold, but pop off by hand):**
- A single **6 × 3 mm N52** disc pulls ~**1.0–1.3 kg (≈10–13 N)** against thick steel *in contact*. But you're going **magnet-to-magnet through two cap walls** (~1.2–1.6 mm total air gap), which drops the *usable* clamp to roughly **30–50%**, so budget ~**0.4–0.6 kg (≈4–6 N) per pair**.
- **Target total shell retention ≈ 2–3× the shell's weight** so it feels solid but releases with a deliberate pull. A bare ASA shell of this size is ~250–350 g, so aim for ~**0.7–1.0 kg** of magnetic hold.
- That's **4–6 magnet pairs** around the skirt seam (≈2.5–3.5 kg raw, ~1 kg usable through the walls) — comfortably poppable by hand yet impossible to rattle loose. **Face dome: 3× 6 × 2 mm pairs** (lighter, ~0.4–0.6 kg total) since it's a small part you remove often.
- Space shell magnets **evenly at the seam** and orient the two thumbscrews as the primary latch; the magnets fill the arc between them so there's no gap you can pry.

### 5. Post-processing for the matte "good paper" finish

The goal is a uniform, warm, sheen-free bead-blasted look — the opposite of glossy 3D-printed plastic. ASA gets you 80% of the way raw; the rest is finishing discipline.

1. **Layer-line strategy first.** The fastest matte look is *not sanding to gloss* — it's keeping consistent fine layers and then unifying the surface with primer. Print the shell at 0.20 mm with clean walls; a matte ASA already scatters light. Knock down any support nubs or seams with 320 grit *locally only*.
2. **Fill + prime.** Two to three light coats of **filler-primer** (Rust-Oleum Filler Primer or Dupli-Color Filler Primer), sanding between coats with 320→400 grit. This buries the finest layer lines and gives one uniform substrate color — critical since the "good paper" tone must be even across a glued seam.
3. **Matte topcoat for the bead-blast look.** Finish with a **dead-matte / ultra-flat clear or color**: Rust-Oleum 2X Ultra Matte or Montana FLAT MATTE in a warm off-white/bone ("color of good paper"). A flat/matte lacquer chemically gives the diffuse, no-gloss, faintly textured surface that reads as bead-blasted — you don't actually need to bead-blast. If you *want* real texture, a very light pass with 220-grit *before* the matte coat adds tooth.
4. **MJF PA12 shortcut:** if you went the SLS/MJF route, skip 1–3 — order it **dyed (Deep-dye) in a warm neutral**; it arrives matte and uniform out of the box. That's the single biggest reason to move final editions to MJF.
5. **The face dome tint (smoked glass).** Three ways, darkest-looking first:
   - **Dye the clear resin** before printing — a few drops of translucent resin dye (SpecCast/Alsa or Elegoo's own translucent) makes the whole dome smoke-gray. Most durable, no coating to scratch.
   - **Spray transparent smoke** on a polished clear dome: **Tamiya TS-71 Smoke** or Alsa Candy in light passes — you control darkness by coats. The LCD must still read through it (aim for ~30–50% transmission), so test on a coupon over a lit screen.
   - **Off-the-shelf smoked PC camera dome** — already tinted, already optically smooth, zero polishing. Often the smart move.
   - To make a *printed* clear dome truly glassy first: wet-sand 400→800→1500→3000, then either a **2K automotive clear coat**, a **Krylon Triple-Thick** clear, or a **dip in clear resin + re-cure** to fill micro-scratches. Then tint.
6. **The single steel-blue accent — used exactly twice.** Mask and paint **only the skirt seam line and the eye ring** in your one steel-blue (a satin, not gloss, so it sits within the matte language). Use fine-line masking tape, a light coat, and pull the tape while wet for a crisp edge. The eye-ring accent goes on the face-dome bezel rim; the seam accent goes in the recessed skirt groove where it catches light as a single deliberate line. Restraint is the whole aesthetic — resist adding it anywhere else.

### 6. Threaded inserts (heat-set M3)

Never thread screws directly into printed plastic on a part that gets opened repeatedly — the threads strip. Use **brass heat-set M3 inserts** (the standard tapered-knurl type, e.g. CNC Kitchen / Ruthex M3×4 mm or M3×5.7 mm) for **both thumbscrew bosses and the Pi/PCB standoffs.**

| Feature | Value | Why |
|---|---|---|
| Pilot-hole diameter (ASA/PETG) | **Ø4.0 mm** (test Ø3.9–4.1 in 0.1 steps) | Too small → melts/bulges the boss and stresses walls; too large → weak pull-out. Measure the *cooled printed* hole, not CAD. |
| Hole depth | insert length **+ 0.5–1.0 mm** | Gives molten plastic somewhere to flow instead of squeezing back up around the insert. |
| Boss outer diameter | **≥ 2× insert OD** (~9–10 mm for M3) | Enough material around the insert for real pull-out and torque strength. |
| Lead-in chamfer | 0.5 mm × 45° at hole mouth | Centers the insert so it goes in straight and flush. |
| Insert length | **thumbscrews: M3×5.7 mm** (higher load); standoffs: M3×4 mm | Longer insert for the parts that see repeated hand-torque. |

**Installation:** use a soldering iron with a heat-set tip (or a spare conical tip), set **240–260 °C for ASA/PETG**. Rest the insert on the hole, press slowly and dead-straight until it's flush or **0.1 mm below** the surface, then back the iron out and press the insert square with a flat metal block while it's still soft so the top is perfectly parallel. Let it cool 30 s before threading. Slight melt squeeze-out around the rim is normal — that's the plastic keying into the knurls, which is exactly the mechanical lock you want.

**Placement:** put the two **thumbscrew inserts in the lower shell section** (so the precision bosses print flat and don't cross a glue seam), and put **PCB/standoff inserts in the internal PA-CF spine**, not the cosmetic shell — the spine is stiffer and stays dimensionally stable at the ~78 °C the stack runs at, so the Pi 5 HAT mounting stays true over time.

---

**Verified references (mid-2026):** large-format enclosed printers — [Bambu H2D / Creality K2 Plus / Qidi / Sovol roundups](https://peccadille.net/best-large-format-3d-printers/), [Bambu Lab large-format store](https://us.store.bambulab.com/collections/large-format-3d-printer); ASA selection & matte finish — [3DPrinting.com ABS/ASA guide](https://3dprinting.com/filament/best-abs-asa-filament/), [Makers101 ASA test](https://makers101.com/best-asa-filament/); clear-resin face dome — [Elegoo Saturn 4 Ultra resin/settings (Liqcreate)](https://www.liqcreate.com/supportarticles/elegoo-saturn4-ultra-resin/); heat-set inserts — [Accu insert hole-size charts](https://accu-components.com/us/p/488-threaded-insert-hole-size-charts-for-3d-printing-pla-petg-resin), [InsertGuide M3 hole size](https://insertguide.com/m3-heat-set-insert-hole-size-for-3d-printed-parts/).

---

## Blender + CAD workflow — modeling the parts for print and fit

**The honest split:** Blender is the right tool for exactly one thing on Atlas — the *organic shell skin*: the single crown-to-skirt arch, the way the vent grille flows into the surface, the skirt transition, the smoked-glass face bezel. It is the *wrong* tool for anything that has to hold a tolerance: the PCB tray, the M2.5 standoffs under the Pi 5, the N20 motor cradles, the magnet pockets for the dock, the two thumbscrew bosses, the HAL slide rails. Blender's mesh math has no notion of ±0.1 mm, its "fillets" are bevels-on-triangles, and a threaded-insert boss modeled there will drift. Parametric CAD (FreeCAD 1.1.1, free, or Fusion 360) carries real dimensions, real fillets, and a feature tree you can edit when the header moves 2 mm.

So run a **hybrid pipeline with STEP as the contract between the two apps.** Sculpt the shell in Blender, engineer every mechanical fixture in CAD, and marry them as *separate printed parts* (preferred — the shell prints alone, the spine/tray prints alone) rather than fusing everything into one mesh. STEP moves solids between tools; STL/3MF feeds the slicer; DXF handles anything 2D.

### 0. Tools and roles (verified current, July 2026)

| Tool | Version | Role in Atlas | Native formats |
|---|---|---|---|
| **Blender** | 4.5 LTS | Shell surface: dome silhouette, vent flow, skirt, face bezel, cosmetic booleans | `.blend`, exports STL / 3MF / OBJ |
| **3D Print Toolbox** | 1.3.2 extension (Jan 2026) | Manifold / normal / wall-thickness / shell-count checks | — |
| **FreeCAD** | 1.1.1 | Mechanical: PCB tray, standoffs, motor mounts, magnet pockets, spine, dock | `.FCStd`, native **STEP** in/out, DXF |
| **Fusion 360** | 2026 release | Same as FreeCAD if you prefer cloud/assemblies | STEP, DXF, 3MF |
| **Slicer** | OrcaSlicer 2.x / Bambu / PrusaSlicer 2.9 | Print prep for shell + internals | consumes STL / **3MF** |

> Note on the toolbox: as of Blender 4.2+ it is **no longer a bundled add-on** — install it from the in-app **Extensions** panel (`Edit → Preferences → Get Extensions`, search "3D Print Toolbox"). It is compatible with 4.5 LTS.

FreeCAD 1.0+ finally fixed the *topological naming problem*, which is exactly why it's now safe to recommend for a build where you'll edit standoff positions repeatedly — earlier versions would silently break references when you changed an upstream feature.

---

### 1. The signature single-arched dome — profile curve → revolve

**First, reconcile the golden-ratio target before you draw anything.** φ = 1.6180.

| Dimension | Design doc | True φ at Ø180 |
|---|---|---|
| Width (diameter) | 180 mm | 180 mm |
| Height | 282 mm → ratio **1.567** | 180 × φ = **291.2 mm** |

The doc's 282 × 180 is *not* golden (it's 1.567). Decide now: either accept 282 as a hard mechanical constraint (battery-over-axle stack height) and call the ratio "near-golden," or push the crown to **291 mm** to hit true φ. This is a one-number decision that propagates through every part — set it first. (I'd hold 180 Ø and take the height to 291; the extra 9 mm is free internal air on a shell that runs at ~78 °C.)

**Draw the profile as ONE Bézier curve, half only:**

1. Front orthographic view (`Numpad 1`), `Shift+A → Curve → Bézier`.
2. Model **only the right half** of the silhouette (X ≥ 0), from crown apex on the Z axis down to the skirt seam. The Screw/Spin will mirror it around.
3. Keep it *one continuous curve, no hard edges*: use **Auto/Aligned handles**, not Vector handles. The whole point of the aesthetic is crown-to-skirt with no visible break — a single Vector handle anywhere prints as a crease. Set the curve's **Shape → Resolution Preview U** to 24–32 so the arc is smooth before it becomes geometry.
4. The apex control point sits *on* the Z axis with a horizontal handle (guarantees a smooth, non-pinched crown when revolved). The skirt-seam point is where your **one steel-blue accent line #1** lives — put a control point there exactly so the seam is a clean latitude.

**Revolve it:**

- Convert curve → mesh only when the profile is final (`Object → Convert → Mesh`), *or* keep it a curve and use **Spin**. For a controllable, non-destructive tower, the clean path is: convert to a profile mesh edge-loop, then add a **Screw modifier**:

| Screw setting | Value | Why |
|---|---|---|
| Axis | Z | Vertical tower |
| Angle | 360° | Full revolve |
| Screw (pitch) | 0 mm | Pure revolve, not a helix |
| Steps | **128** (viewport) / **256** (render+export) | 256 around Ø180 = ~2.2 mm facet chord; below the bead-blast texture, invisible. Fewer facets = polygonal skirt. |
| Merge / Clamp | On, 0.01 mm | Welds the seam vertices so it stays one watertight shell |

- Prefer **Screw modifier over Spin** here because it stays live — you can keep tweaking the Bézier profile and watch the tower update.

**Then Boolean-cut the four openings** (each as its own hidden cutter object, `Boolean` modifier set to **Exact**, keep cutters in a hidden "CUTTERS" collection so they don't export):

| Cutter | Feature | Placement note |
|---|---|---|
| Face opening | Round LCD aperture | Front, on the mast-rake datum. Aperture = LCD **active-circle Ø + ~1 mm reveal**; recess a lip for the smoked-glass dome. Pull the exact active-area diameter from the panel datasheet — do **not** guess it from the "3.1 in" number (round panels quote diagonal/outer glass, not active pixels). |
| Rear vent grille | Airflow for the ~78 °C, fan-forced sealed shell | Louvered slots, radiused ends; total open area sized to the FAN duct, not decorative. |
| Recessed e-stop | Crown-recessed button (GPIO26 sense) | Recess deeper than the button cap so nothing snags — it's a safety control. |
| Camera/mic crown | CSI camera window + 4-mic ring ports | On the crown; see mast rake §4. |

Do these cuts **after** Solidify (next), so the slot walls have real thickness on both faces.

---

### 2. Wall thickness — Solidify

Target **2.5–3.5 mm** wall. Why that band, concretely:

- **Lower bound 2.5 mm** — this is a sealed, always-on shell held by only two thumbscrews and dropped occasionally; below ~2.5 mm the arch flexes, thumbscrew bosses pull through, and heat-set inserts don't get enough wall to grip.
- **Upper bound 3.5 mm** — beyond that you warp a 282–291 mm print, waste filament, and gain no stiffness; 3.5 mm also keeps the bead-blast/finish sanding pass from ever cutting through to daylight.
- Use **3.0 mm** nominal; go to 3.5 mm locally around the thumbscrew bosses and face-opening lip (model those as separate reinforcing solids, not by thickening the whole shell).

Solidify settings:

| Setting | Value | Why |
|---|---|---|
| Thickness | 3.0 mm | Nominal wall |
| Offset | **−1** (inward) | Keeps the **outer** silhouette dimensionally exact — your golden-ratio Ø180 and crown height are the *outside* skin. Offset 0 or +1 would grow the OD and break the ratio. |
| Even Thickness | On | Constant wall through the crown curvature |
| Rim / Fill | On | Closes the wall edges at the vent and face apertures so they're solid, not paper-thin |

**Order of operations matters:** silhouette surface → **Solidify** → **then Boolean** the apertures through the finished wall. Cutting holes through an already-thick wall gives clean, manifold slot edges; solidifying *after* booleaning tends to leave zero-thickness rims the slicer chokes on.

---

### 3. Getting a manufacturable mesh

1. **Apply modifiers in stack order**, top-down, only when final: Screw → Solidify → Boolean (`Ctrl+A` / Apply on each). Everything above stays live until this point.
2. **Normals:** enable **Overlays → Face Orientation** (blue = outside, red = inside). Any red = flipped normal the slicer reads as a hole. `Shift+N` = Recalculate Outside. On a booleaned shell, recalc *after* applying booleans.
3. **3D Print Toolbox → Check All.** For a shippable shell you want:
   - **Non-manifold edges: 0** (the single most common cause of a slicer refusing/mis-solidifying a part)
   - **Intersecting / self-intersecting faces: 0**
   - **Zero-area faces / zero-length edges: 0**
   - **Shells: 1** (exactly one watertight island — the toolbox's Shells check confirms it)
   - Overhang / thickness reports as reference (steep crown overhangs → plan tree supports or print face-down)
4. **Remesh/decimate — sparingly.** A clean quad revolve is *already* good topology; don't reflexively voxel-remesh it. Voxel Remesh only if booleans left a shredded intersection you can't repair by hand; if you do, use a voxel size ≤ 1 mm so you don't round off the arch. **Decimate** is for cosmetic weight reduction only — never on mating surfaces or the face lip.
5. **Export — and get millimeters right, or you print a doll:**

| Export setting | Value | Why |
|---|---|---|
| Scene Unit Scale | Blender treats 1 BU = 1 m by default | Set `Scene Properties → Units → Length = Millimeters`, Unit Scale 0.001, so 1 BU reads as 1 mm |
| STL export **Scale** | 1.0 (if units set as above) or 1000 (if left at meters) | This is the #1 wrong-scale trap |
| Format | **3MF preferred**, STL fallback | 3MF carries units + multiple objects + is what OrcaSlicer/Bambu/Prusa want in 2026; STL is unit-less and forgets scale |
| Selection Only | On | Export just the shell, not the cutters/reference imports |
| Apply Modifiers | On | Bakes anything you left live |
| Forward/Up | Y-up or Z-up per slicer | Match your slicer's convention so it lands flat |

---

### 4. Fit workflow — do the assembly in CAD, not Blender

Blender's STEP import is weak (it needs an add-on like STEPper/CAD-Sketcher and still tessellates solids). **Do the fit check in FreeCAD/Fusion**, where STEP is native, and bring the *shell* in the other direction as an STL/3MF reference body. Import the real STEP solids:

- **Raspberry Pi 5** (official STEP), the **custom HAT** (export from your PCB tool as STEP — see the PCB section), **4S2P 18650 pack**, **N20 motors + wheels**, **Camera Module 3**, the **round LCD**, TB6612FNG carrier, dock pogo block.

Lay out the internal **"spine"** — every board mounted to one billet/tray that slides out as a unit behind the HAL:

| Clearance check | Target | Why |
|---|---|---|
| PCB edge → shell inner wall | ≥ 2.0 mm | Assembly tolerance + insulation on a sealed shell |
| Any board → board (stacked) | Per header height (Pi5 + HAT ≈ 20–25 mm) | Confirm the HAT stack clears the camera ribbon |
| Airflow gap (fan path) | ≥ 5 mm continuous | It idles near the 78 °C throttle — the vent→fan→board channel must stay open |
| Spine slide travel | Full pack length + finger clearance | The whole spine must extract without fouling the skirt |
| Thumbscrew boss → nearest board | ≥ 3 mm | So you can drive the screw without hitting a connector |

- **Camera mast: 2° forward rake.** Model the mast as its own feature and rotate **2° about the pitch (X) axis toward the front**, referenced to the shell's front datum. Verify the CSI ribbon still has slack at 2° and that the lens cone clears the crown aperture through the full rake.
- **AprilTag dock face:** keep the docking face **flat, vertical, and a known printed size** (the tag must be planar and its edge length exact for pose solving). Place it as a recessed flat on the skirt/dock so the tag can't bow when the shell flexes, and confirm the camera at 2° rake actually sees it at docking distance.

---

### 5. Where to get the component 3D models

| Part | Best source | Format | Caution |
|---|---|---|---|
| Raspberry Pi 5, Cam Module 3 | **Official** `datasheets.raspberrypi.com/rpi5` (`RaspberryPi5-step.zip`) + mechanical-drawing PDF | STEP + PDF | Use official over community — connector heights are right |
| N20 motors, VL53L1X, IMU carriers | Manufacturer (Pololu, ST, DFRobot, Adafruit) | STEP | Often on the product page's "Resources" tab |
| Round LCD, MAX98357A, mic boards | Vendor (Waveshare/Adafruit) STEP or datasheet dims | STEP / PDF | If no STEP, model a simple bounding solid from the datasheet |
| 40-pin header, JST, USB-C, pogo pins | **SnapEDA / Ultra Librarian** | STEP (+ footprint/symbol) | Same source feeds your PCB tool — keeps board and enclosure consistent |
| Anything missing | **GrabCAD** community library | STEP | **Verify against the physical part / datasheet** — community models are frequently wrong by a millimeter or a revision |

Rule: a downloaded STEP is a *hypothesis* until you've checked its critical dimension (header pitch, mount-hole spacing, connector height) against the datasheet or calipers.

---

### 6. Concrete step order and the file matrix

**Order:** silhouette → shell → internals → print files.

1. **Silhouette (Blender):** lock the height:width decision (§1), draw the half-profile Bézier, Screw-revolve to the tower.
2. **Shell (Blender):** Solidify to 3.0 mm inward, then Boolean the four apertures, then run 3D Print Toolbox to zero out non-manifold/normals/shells.
3. **Internals (CAD):** import component STEP, build the spine/tray, standoffs, motor mounts, magnet pockets, dock, thumbscrew bosses; import the shell STL as a reference body and check every clearance in §4; set the 2° mast rake and the AprilTag flat.
4. **Reconcile:** if a fixture forces the shell to change, edit the *Blender* profile/cutters (not the exported mesh) and re-export — keep both apps' sources authoritative, never hand-edit exports.
5. **Print files:** slice shell and internals separately.

**File matrix — what each downstream tool needs:**

| Deliverable | File | Consumed by | Produced from |
|---|---|---|---|
| Shell for printing | **3MF** (STL fallback) | Slicer (OrcaSlicer/Prusa/Bambu) | Blender |
| Spine / tray / mounts for printing | **3MF / STL** | Slicer | CAD |
| Mechanical interfaces (standoffs, mounts, dock, boss positions) | **STEP** | CAD fit assembly; anyone re-CADing a part | CAD |
| Custom HAT body for enclosure fit | **STEP** | CAD fit | PCB tool export |
| PCB board outline / cutouts to the fab | **DXF** (+ Gerbers separately) | PCBWay/JLCPCB, or a laser/water-cut skirt gasket | CAD / PCB tool |
| Shell as reference inside CAD | **STL / 3MF** | CAD fit assembly | Blender |
| 2D drawings (skirt gasket, dock plate, any panel) | **DXF** | Laser/CNC vendor, documentation | CAD |

Keep it disciplined: **STL/3MF is mesh and goes to the slicer; STEP is solid and goes to CAD and the enclosure fit; DXF is 2D and goes to the fab or a 2D cutter.** The moment you try to hold a tolerance in an STL, or sculpt the paper-matte dome in CAD, you're using the wrong file in the wrong tool.

---

*Verified current (July 2026):* [Blender 3D Print Toolbox 1.3.2](https://extensions.blender.org/add-ons/print3d-toolbox/) · [FreeCAD 1.1.1 release notes](https://github.com/FreeCAD/FreeCAD/releases) · [Raspberry Pi 5 mechanical drawing + STEP](https://datasheets.raspberrypi.com/rpi5/raspberry-pi-5-mechanical-drawing.pdf)

---

# Bill of Materials, parts ordering, and manufacturing flow

This section turns ATL-HW-001 into a purchasable BOM, an exact PCBWay order recipe tuned for a *guaranteed, durable* board, and a start-to-finish build checklist. Prices are 2026 USD, single-unit, before shipping/tax. Where the design doc's rough numbers were optimistic (motors, cells, power), the real figure is called out — plan for a realistic **~$410–$470 prototype**, not $310.

## 1. Full BOM (one robot)

### 1a. Compute & vision

| Qty | Part | Recommended part no. / module | Supplier | Unit $ | Notes (why) |
|----|------|------------------------------|----------|-------|-------------|
| 1 | SBC | **Raspberry Pi 5, 8 GB** (SC1112) | PiShop / CanaKit / DigiKey | 80 | 8 GB is the floor for on-device wake-word + vision + the DeckOS stack running warm. |
| 1 | Storage | **Samsung PRO Endurance 128 GB microSD** (MB-MJ128) *or* NVMe on M.2 HAT | Amazon / DigiKey | 20 | Continuous logging destroys consumer SD cards; PRO Endurance is rated for high write cycles. NVMe is better but competes with your HAT for the stack — see §3 note. |
| 1 | Heatsink/fan | **Noctua NF-A4x10 5V PWM** + low-profile Cu heatsink | Noctua / DigiKey | 15 | Runs on FAN PWM GPIO4; SSO2 bearing survives 24/7 near 78 °C. Ducting for the *sealed* shell is a thermal-section problem — the fan itself belongs here. |
| 1 | Camera | **Raspberry Pi Camera Module 3 Wide** (SC0873) | PiShop / DigiKey | 35 | 120° FoV, autofocus, CSI-2 to the Pi's own connector (not your HAT). Buy the ~200–300 mm FPC for the mast run. |

### 1b. Face / display

| Qty | Part | Recommended part no. / module | Supplier | Unit $ | Notes (why) |
|----|------|------------------------------|----------|-------|-------------|
| 1 | Round LCD 480×480 | **2.1″ round IPS, ST7701S** — DisplayModule *DM-TFTR21-455* / Waveshare 2.1″ Round / Elecrow equivalent | DisplayModule, Waveshare | 25–35 | ST7701S is the standard 480×480 round controller. **Read the callout below — the interface and the "3.1″" size both need reconciling.** |

> **⚠ Display reality check (real money — read before you buy).**
> 1. **Interface:** the ST7701S is *not* a plain 4-wire SPI framebuffer. It uses **3-/4-wire SPI for register config + an 18-bit RGB (DPI) bus for pixel data**. On a Pi 5 that RGB bus eats ~28 GPIO and collides head-on with your pin map. Your options: **(a)** drive it over the Pi's **DPI/RGB interface** and rework the pinout (heavy); **(b)** keep it on SPI0 by switching to a **QSPI round AMOLED** — e.g. a **CO5300/SH8601-based 1.85″–2.06″ round 466×466 or 410×502** panel — which *is* genuinely SPI-fed at speed (this is what your `SPI0 @62 MHz + DC/RST` map actually wants); or **(c)** use a small **round DSI panel on the Pi 5's second MIPI connector** (the Pi 5 has two 4-lane MIPI ports; CSI is taken by the camera, the other can run DSI) and free SPI0 entirely.
> 2. **Size:** there is **no commonly stocked round 480×480 module at 3.1″** — the largest common round 480×480 is **2.1″**. Reconcile by (i) mounting the 2.1″ behind a magnifying smoked dome, (ii) stepping to a **3.4″ *square* 480×480 (GC9503, SPI+RGB)** cropped to a circle by the bezel, or (iii) accepting a round AMOLED at 466×466. Update ATL-HW-001 to whichever you commit to; the mechanical `face` cutout depends on it.

### 1c. Audio (I2S)

| Qty | Part | Recommended part no. / module | Supplier | Unit $ | Notes (why) |
|----|------|------------------------------|----------|-------|-------------|
| 4 | MEMS mic (I2S) | **InvenSense ICS-43434** (bare, placed on a crown "mic-ring" satellite PCB) | DigiKey / Mouser | 2–3 ea | 24-bit, ~65 dBA SNR, high AOP → best far-field wake-word. **4 mics on one I2S data line = 2 max**; you need TDM or a 2nd data line — resolve in the electrical section. |
| — | *Easy alt* | **Adafruit SPH0645 breakout** (#3421) ×4 | Adafruit | 6 ea | Solder-free but only 18-bit, lower AOP. |
| — | *Plug-and-play alt* | **Seeed ReSpeaker Lite** (XMOS XU316) or ReSpeaker 4-Mic Array HAT | Seeed | 15–25 | Offloads TDM/beamforming; trades the clean I2S ring for a pre-made board. |
| 1 | Amp | **Adafruit MAX98357A I2S 3W Class-D** (#3006) | Adafruit / DigiKey | 6 | Direct I2S-out, no DAC needed. |
| 1 | Speaker | **3W 4Ω, 40 mm** (Adafruit #1314 or CUI CDS-40188) | Adafruit / DigiKey | 3 | Matches the amp's 4Ω load. |

### 1d. Sensing (I2C1, via TCA9548A)

| Qty | Part | Recommended part no. / module | Supplier | Unit $ | Notes (why) |
|----|------|------------------------------|----------|-------|-------------|
| 5 | ToF ranger | **VL53L1X** — Pololu #3415 or Adafruit #3967 (carriers) | Pololu / Adafruit | 12–14 ea | 4 m range, 400 kHz I2C. All share address 0x29 → **must** sit behind the mux. Bare GY-53 clones (~$5) work but QC is a lottery — carriers for reliability. |
| 1 | I2C mux | **Adafruit TCA9548A** (#2717) | Adafruit / DigiKey | 7 | 8-channel; fans out the five identical ToF sensors. |
| 1 | IMU | **Adafruit BNO085 / BNO086 9-DOF** (#4754) | Adafruit / SparkFun | 20 | On-chip sensor fusion (quaternion out) offloads the Pi. BNO086 is the drop-in current-production part. |
| 1 | Current sense | **Adafruit INA219** (#904) — or **INA260** (#4226, integrated shunt) | Adafruit / DigiKey | 10 | Doubles as your **software fuel gauge** by coulomb-counting the pack rail (see BMS note). |

### 1e. Motion (drive)

| Qty | Part | Recommended part no. / module | Supplier | Unit $ | Notes (why) |
|----|------|------------------------------|----------|-------|-------------|
| 2 | Gearmotor | **Pololu 100:1 Micro Metal Gearmotor HPCB 12V, *extended shaft*** (~#4805-class — confirm SKU for the 100:1 12V extended-shaft variant) | Pololu | 22–28 ea | **100:1** is the sweet spot for a ~282 mm / ~1.3 kg tower on ~60–65 mm wheels: ~0.3–0.5 m/s top speed with enough torque to climb thresholds and hold on inclines. Go **150:1** for more torque/slower, **50:1** for faster/flatter. Extended shaft is required to fit the encoder. |
| 1 | Encoders | **Pololu Magnetic Encoder Pair Kit, 12 CPR** (#4761) | Pololu | 9 | 12 CPR × 100 gearing = **1200 counts/rev** output → clean odometry on the 4 encoder IRQ lines. |
| 1 | Motor driver | **Pololu TB6612FNG carrier** (#713) or **SparkFun ROB-14451** | Pololu / SparkFun | 9–10 | 1.2 A/ch continuous, 3.2 A peak — ample for N20s. **Buy genuine** — clone TB6612s run hot and die. |
| 2 | Wheels + tires | **Pololu 60–70 mm wheel** for 3 mm D-shaft (e.g. #1435/#3690) | Pololu | 8 ea | Rubber tire for traction on the diff-drive base. |
| 1 | Caster | **Pololu ball caster, 3/8″–1/2″ metal** (#955/#951) | Pololu | 3 | Rear caster per the two-wheel + caster geometry. |

### 1f. Power

| Qty | Part | Recommended part no. / module | Supplier | Unit $ | Notes (why) |
|----|------|------------------------------|----------|-------|-------------|
| 8 | 18650 cell | **LG INR18650-MJ1 (3500 mAh)** or **Samsung INR18650-35E** — *genuine, matched* | 18650BatteryStore / IMR Batteries / Liion Wholesale | 6–9 ea | 4S2P of 3500 mAh = ~7 Ah ≈ your 6.8 Ah target at ~100 Wh. Your draw is modest (pack ~2–3 A), so **capacity cells beat high-drain cells**. If motor surge worries you, **Molicel P28A**. **Never** Amazon/AliExpress "9900 mAh" cells (§9). |
| 8 | Cell holders / spot-weld | Nickel strip + fish-paper, or **4S2P holder** | DigiKey / Amazon | 8 | Spot-welded pack is more durable than spring holders under vibration; insulate the positive ring. |
| 1 | BMS | **JBD (Jiabaida) 4S 30A smart BMS** (common-port, UART) — or Daly 4S 30A | Overkill Solar / JBD store | 20–28 | Balance + OV/UV/OC/short protection. **I2C fuel-gauge caveat:** smart BMSs report SoC over **UART, not I2C**. To honor the I2C-gauge line either (a) let the **INA219 coulomb-count** in software (no extra part), or (b) add a **TI BQ34Z100-G1 / MAX17055** I2C gauge on GPIO2/3. |
| 1 | 5 V rail | **Pololu 5V 9A step-down D24V90F5** | Pololu | 25 | Pi 5 alone wants 5 V/5 A and peaks higher; a 9 A reg gives headroom for Pi+display+audio and **prevents brownout SD corruption**. Don't run the Pi on a 5 A part at the edge. |
| 1 | 12 V / motor rail | **Buck-boost** (TPS55289 module or Pololu S18V-series) — **or feed motors from raw pack** | Pololu / Amazon | 15–25 | **Design gotcha:** a plain buck *can't hold 12 V* — a 4S pack sags to ~12.0 V empty, below the buck's dropout. Either use a **buck-boost to pin 12 V**, or run the TB6612/N20s **directly off the pack (12–16.8 V)** through the e-stop and cap duty cycle in firmware. |
| 1 | Dock PSU | **19 V / 3.42 A (65 W) brick** (barrel or USB-C PD trigger to 20 V) | DigiKey / Amazon | 15 | 19 V gives CC/CV headroom to charge the 4S pack to **16.8 V**. |
| 1 | Charger front-end | **CC/CV to 16.8 V** (TI BQ25703/BQ25887 or a set buck) + **ideal-diode/Schottky** reverse-protect (e.g. SS54 or a P-FET) | DigiKey | 8–12 | 4S full charge = 4.20 V × 4 = 16.8 V. Reverse-polarity diode per the doc. |
| 1 | Fuse | **15 A blade or mini-ANL** inline, pack→load | Amazon / DigiKey | 3 | Last-ditch protection independent of the BMS (§9). |
| 1 | E-stop | **16 mm latching push-button (mushroom, recessed)** in the **12 V/motor rail** | DigiKey (E-Switch/Schurter) | 6 | Hard-cuts drive power; sensed on GPIO26 for software awareness. |

### 1g. Dock, structure, fasteners, wiring

| Qty | Part | Recommended part no. / module | Supplier | Unit $ | Notes (why) |
|----|------|------------------------------|----------|-------|-------------|
| 4–6 | Pogo pins | **Mill-Max spring-loaded pins** (0906/0965 series) + flat targets | DigiKey / Mouser | 1–2 ea | Gold contacts survive thousands of dock cycles; size current pins for the 19 V charge current. |
| ~20 | Heat-set inserts | **M3 brass, CNC Kitchen** (M3×5.7×4.6) or McMaster **94459A130** | CNC Kitchen / McMaster | 0.15 ea | Reusable threads in the printed shell → the "swap behind a HAL" requirement survives repeated service. |
| 6–10 | Magnets | **N52 neodymium disc, 6×3 mm** | K&J Magnetics / Amazon | 0.4 ea | Module/dome retention; keep clear of the BNO085 (magnetometer). |
| set | Fasteners | M3 SHCS assortment + **2× M4 knurled captive thumbscrews** | McMaster / Amazon | 8 | The two thumbscrews that hold the one-part shell. |
| set | Connectors | **JST-PH 2.0** (signals), **JST-XH** (balance), **XT30** (pack main), 18–22 AWG silicone wire | DigiKey / Amazon | 12 | Genuine JST only — clone housings cause intermittent faults (§8). |

**Subsystem subtotals (approx):** Compute+vision **$150** · Face **$30** · Audio **$25** · Sensing **$95** · Motion **$95** · Power **$135** · Dock/structure/wiring **$45** → **~$575 with the fan/storage/caster** the doc omitted, or **~$430** if you strip to the doc's original scope. Budget **$450** and don't be surprised by shipping.

---

## 2. Supplier strategy

| Buy from | For | Why |
|---------|-----|-----|
| **DigiKey / Mouser** | Bare ICs (ICS-43434), passives, connectors, fuses, pogo pins, the E-stop, charger front-end parts | Authentic, traceable, single consolidated cart, fast. Use for anything safety- or reliability-critical. |
| **Adafruit / SparkFun** | Breakouts: MAX98357A, VL53L1X, TCA9548A, BNO085, INA219, SPH0645 | Known-good designs, real datasheets, drivers/tutorials, honest parts. Slightly pricier, worth it for bring-up. |
| **Pololu** | N20 gearmotors, encoders, TB6612 carrier, wheels, caster, 5 V/buck regs | The reference source for small-robot drivetrain; genuine TB6612 and matched motors. |
| **18650BatteryStore / IMR Batteries / Liion Wholesale** | Genuine 18650 cells | The *only* place to trust cell authenticity (§9). |
| **Amazon / AliExpress** | Bucks, dock brick, nickel strip, generic wire, magnets | Fine for commodity mechanical/power modules **with caveats**: buy from reviewed sellers, expect ±20% spec variance, bench-test every buck's output before it touches the Pi, and **never** cells or the BMS here. |

**Consolidate for shipping:** put one order each at DigiKey (ICs/passives/connectors), Adafruit *or* SparkFun (breakouts — pick one to avoid two shipments), and Pololu (drivetrain). That's **three parcels** instead of a dozen. Order the PCB/PCBA (§4–6) in parallel so lead times overlap.

---

## 3. What the fab sources vs. what you consign

Split the design's BOM into **fab-sourced** (cheap, standard, let PCBWay/JLCPCB place from their library) and **consigned** (you ship them the part, or you hand-solder it after).

| Let the fab source (turnkey, their library) | Consign or hand-place |
|---|---|
| All **passives** (0402/0603 R/C, ferrites, TVS), LEDs | **Raspberry Pi 5** — never goes on the HAT; the HAT plugs into *it* |
| **TB6612FNG**, common LDOs, MOSFETs, the mux (**TCA9548A**), the amp (**MAX98357A**) if on the JLC/PCBWay standard library | The **2.1″ round LCD** — module, mounts off-board via FPC/JST |
| Standard connectors (2×20 header, JST footprints) if in-library | **BNO085/BNO086** — expensive, long-lead, moisture-sensitive; hand-solder or consign a reel/cut-tape |
| The **INA219** and passives around the shunt | **VL53L1X** sensors — go on the crown/skirt satellite boards, not the HAT |
| — | Anything you only have 1–2 of (consignment beats a full reel MOQ) |

Practical rule: **let the fab place everything that's a standard, in-stock library part with ≥100 stock** (near-zero placement cost, better yield than hand-soldering QFNs), and **consign the few expensive, low-stock, or mechanically-mounted parts.** Prefer the fab's **Basic/Preferred (no-fee) library** parts when choosing passive values to avoid per-part loading fees. For QFNs like the BNO085 and TB6612, machine placement + reflow is *more* reliable than hand-soldering — consign the part but let them place it if they'll accept it.

---

## 4. Where to draw the PCB (online + the desktop gold standard)

You asked for a good **online** place. All three below export standard Gerber/BOM/CPL that PCBWay accepts:

| Tool | Type | Pick it when |
|------|------|-------------|
| **Flux.ai** | Browser, modern, AI copilot, real-time collab | You want fully in-browser, **fab-neutral** exports, and a fast 2026 workflow. Good default for "online." |
| **EasyEDA Pro** | Browser (by JLCPCB) | You want the **JLCPCB parts library auto-linked** so passives self-source and one-click PCBA — Gerbers still go to PCBWay fine. Slightly locked to the JLC ecosystem. |
| **KiCad 10.0.4** | Free desktop (current stable, June 2026) | **The gold standard for a guaranteed, portable design:** best DRC, huge libraries, fab-neutral, and **both PCBWay and JLCPCB ship KiCad plugins** for one-click Gerber/BOM/CPL + ordering. Not "online," but it's what I'd build a reliability-critical board in. |

Recommendation: **prototype the layout in Flux.ai or EasyEDA Pro if you want browser-only; move to KiCad 10 if you want the strongest DRC and zero fab lock-in.** Whatever you choose, keep the 40-pin header on the **HAT mechanical spec** (65 × 56.5 mm, mounting holes 58 × 49 mm, ⌀3.5 mm) so it seats correctly on the Pi 5.

---

## 5. Exact PCBWay order-form values (tuned for high reliability)

Enter these on the PCBWay prototype form. The **reliability levers that matter most** are ENIG + 2 oz copper + High-Tg FR-4 + tented vias + relaxed DRC + the free file review/E-test — *not* exotic options.

| Form field | Value to select | Why |
|-----------|-----------------|-----|
| Board Type | **Single pieces** | It's one HAT design. |
| Different designs in panel | **1** | — |
| Size (X × Y) | **65 × 56.5 mm** | Conforms to the Pi HAT mechanical spec → seats on the Pi 5 and its mounting holes. |
| Quantity | **10** | PCBWay's price floor is ~5–10 pcs anyway; spares for rework. |
| Layers | **4** | Signal/GND/PWR/signal → clean return paths for the 62 MHz SPI, I2S, 20 kHz motor PWM. |
| Material | **FR-4** | — |
| FR4-TG | **TG155** (step to **TG170** if budget allows) | You run continuously near 78 °C; TG130 is marginal, **TG155/TG170 gives thermal-cycling margin** and lower delamination risk. |
| Thickness | **1.6 mm** | Standard HAT rigidity + correct fit for the 2×20 header and standoffs. |
| Min track/spacing | **6/6 mil** | Relaxed from PCBWay's 4 mil floor → **higher yield and fewer field-failure hairlines**. Only tighten if a QFN escape forces it. |
| Min hole size | **0.3 mm** | Relaxed from the 0.15 mm minimum (which carries a surcharge and lower yield) → cheaper and more robust. |
| Solder mask | **Green** (yield) — or **Matte Black** (aesthetic; board is hidden in the shell) | Green is highest-yield/lowest-cost; the board isn't visible, so pick green unless you want black. |
| Silkscreen | **White** | Standard, legible. |
| Surface finish | **Immersion gold (ENIG)** | **The key reliability choice:** flat coplanar pads for the QFNs (BNO085/TB6612), no oxidation, long shelf life, best hand-rework — worth the upcharge over HASL. |
| Via process | **Tenting (cover) vias** | Prevents solder wicking/shorts under the header and BGAs; cleaner assembly. |
| Finished copper | **2 oz** | Motor/charge rails carry real current and heat; 2 oz **widens current capacity and spreads heat**. |
| Impedance control | **No** (default) — **Yes only if** your SPI/CSI routing needs it | On a ~65 mm HAT the traces are short; skip it. If you enable it, spec **50 Ω single-ended** for SPI and let PCBWay adjust the stackup. The camera CSI-2 is on the Pi's own connector, not your HAT. |
| Gold fingers / castellation | **No** | Not an edge-connector board. |
| Confirm production file | **Yes** | Free PCBWay engineer DFM review — **catches your Gerber errors before they cut copper.** Always on. |
| Electrical test | **100% flying-probe / E-test** (default) | Guarantees continuity on every board — non-negotiable for "guaranteed." |
| Remove order number | **No** *(or "Specify a location")* | Let them place their tiny ID in a non-critical spot. |

*JLCPCB alternative:* their 4-layer JLC04161H-3313 stackup supports impedance control and goes down to 3.5 mil; use the same philosophy — **ENIG, 2 oz, tented vias, confirm production file** — if you price-shop. PCBWay tends to be more forgiving on High-Tg + 2 oz + ENIG combos for small runs.

---

## 6. Manufacturing flow (end-to-end checklist)

1. **Finalize the schematic.** Lock the pin map (BCM assignments from ATL-HW-001), resolve the display-interface decision from the §1b callout, and add TVS on the dock input, a 15 A fuse symbol, and the reverse-polarity diode.
2. **Run DRC + ERC** against the §5 rules (6/6 mil, 0.3 mm holes, 2 oz clearances). Zero errors before export. Do a **3D check** in KiCad/EasyEDA for header + connector collisions on the stack.
3. **Export the fab package:** **Gerber (RS-274X)** + **NC drill**, **BOM (CSV)**, and **CPL/centroid (pick-and-place)**. Generate an **IPC-2581 or ODB++** too if the fab accepts it — richer than Gerber.
4. **PCBWay quote & upload** using the §5 values. Choose **turnkey assembly** for library passives + drivers; mark the **Pi, LCD, BNO085, VL53L1X as consigned/DNP**. Wait for the free **DFM/production-file confirmation** and clear any queries before paying.
5. **Order the stencil** (framan less, laser-cut, tuned for your finest pitch) if you'll ever hand-assemble spares; PCBA orders include it in setup.
6. **Order/consign parts in parallel** (three parcels, §2). Ship consigned parts (Pi excluded) to PCBWay per their consignment instructions; keep a spare Pi/LCD at your bench for bring-up.
7. **PCBA runs** (SMT paste → place → reflow → AOI). Confirm they'll place the consigned QFNs; if not, receive the SMT-populated board and hand-solder those.
8. **Receive & test the bare/assembled board — power OFF first:**
   - **Continuity/short check:** ohm-out 5 V→GND, 3V3→GND, 12 V→GND for shorts *before* applying power.
   - **Rail bring-up on a bench supply, current-limited:** feed the dock input, verify **5 V and the motor rail** are in spec and clean under load; confirm the **reverse-polarity diode** blocks reversed input.
   - **E-stop:** confirm pressing it kills the 12 V/motor rail and that **GPIO26 reads the state**.
9. **Flash & bring up per subsystem** (one at a time, log each): boot the Pi from the SD/NVMe → **I2C scan** (expect BNO085, INA219, TCA9548A, and each VL53L1X per mux channel) → **I2S** mics in + amp out → **SPI** display "face" → **motor PWM + encoders** (wheels off the ground) → **fan PWM** → **dock/charge sense**.
10. **Print the shell** (§7 material note) — one-part shell + smoked-glass face dome + skirt.
11. **Mechanical assembly:** heat-set inserts → mount Pi + HAT stack, motors/encoders, ToF ring, mic ring + camera mast, speaker, pack + BMS → route JST/XT30 harness → close shell with the two thumbscrews.
12. **Dock/charge test:** dock the robot, confirm **pogo contact + 19 V in**, watch the charger hold **CC then CV to 16.8 V**, verify BMS balancing engages and the INA219 SoC tracks. Then a **full discharge → recharge cycle** to validate runtime against the 100 Wh / 11.2 W budget (~7–8 h typ).

---

## 7. Cost + lead-time summary

| Line item | Spec | Cost (proto) | Lead time |
|-----------|------|-------------|-----------|
| Bare PCB (proto) | 4-layer, 65×56.5 mm, ENIG, 2 oz, TG155, 10 pcs | **$80–130** | ~5–7 day build + 3–5 day DHL ≈ **~2 weeks** |
| PCBA (assembly) | Turnkey passives/drivers, ~5 boards, stencil + setup, consigned Pi/LCD/IMU | **$150–300** | +1 week over bare board |
| Electronic parts | The §1 BOM (breakouts, motors, sensors, cells, power) | **$400–470** | DigiKey/Adafruit/Pololu 2–5 days; cells 3–7 days |
| 3D print | ~1.2 kg shell filament (**PETG/ASA matte**) + ~150 g smoke resin for the dome | **$35–55** | 12–24 h print/robot |
| **First working robot** | | **~$700–900 all-in** | **~2.5–3 weeks** (fab is the long pole) |

**Shell material note (why not PLA):** internal air sits at 45–55 °C near a Pi throttling at 78 °C; **PLA's Tg (~55–60 °C) means it will creep and sag.** Print the *structural* shell in **PETG (matte)** or **ASA** (better heat + UV, natural matte "good-paper" look after bead-blast). Use PLA only for **fit-check prototypes**. The smoked-glass face is **clear/smoke SLA resin, tinted**, or a cast-acrylic dome.

**Where to save:** passives (fab library), enclosure filament, generic hookup wire, magnets, the dock brick. **Where NOT to cheap out:** the **BMS** (genuine JBD/Daly), the **motor driver** (genuine TB6612 — clones cook), **connectors** (genuine JST/Molex — clone housings = intermittent faults that are hell to debug), the **5 V regulator** (brownouts corrupt the SD), and the **cells** (§9).

---

## 8. Li-ion pack safety (4S — treat this as the highest-risk subsystem)

- **Genuine cells only.** Buy **LG MJ1 / Samsung 35E / Molicel** from a reputable seller (§2). Amazon/AliExpress "ultra-capacity" 18650s are re-wrapped junk with fake ratings — a fire risk in a sealed, continuously-hot enclosure.
- **Match and top-balance before the first build.** Same brand/batch, capacity-matched; charge every cell to the *same* voltage (4.20 V) before assembling into 2P groups. Don't rely on the BMS to balance a wildly unbalanced pack.
- **Real BMS, always in-circuit.** The JBD/Daly 4S 30A provides **per-cell OV (4.25 V), UV (~2.5 V), overcurrent, short-circuit, and balance**. Wire the **balance leads in the correct order** — a swapped balance tap can over-charge a cell.
- **Independent fuse.** A **15 A inline fuse** between pack and load protects even if the BMS FETs fail shorted. The BMS is protection #1; the fuse is protection #2.
- **Charge correctly:** 4S Li-ion tops at **16.8 V**, CC then CV, charge current ≤ ~0.5C (~3–3.5 A for this pack). The 19 V dock feeds a **proper CC/CV charger front-end**, not the pack directly. Charge in the **0–45 °C** window — relevant since the robot runs warm; don't charge a hot pack.
- **Hardware E-stop in the 12 V/motor rail** (per the doc) cuts drive instantly; keep it mechanically accessible even though it's recessed in the crown.
- **Reverse-polarity + inrush protection** on the dock input (Schottky/ideal-diode + a soft-start), so a mis-docked or reversed 19 V can't back-feed the pack.
- **Thermal + venting:** cells in a **sealed** shell that runs near throttle need a defined thermal path and a **vent/relief detail** — a Li-ion cell venting inside a fully sealed tower is the worst case. Coordinate this with the thermal/mechanical section before you seal it up.
- **Never** puncture, reverse, or hard-short the pack; store at ~3.7–3.8 V/cell (~40–60% SoC) if the robot sits unused.

---

*Verification (checked July 2026):* [KiCad 10.0.4 release](https://www.kicad.org/blog/2026/06/KiCad-10.0.4-Release/) · [PCBWay capabilities](https://www.pcbway.com/capabilities.html) · [PCBWay impedance control](https://www.pcbway.com/helpcenter/ordering_parameter_instruction/What_is_Impedance_Control_.html) · [2.1″ round 480×480 ST7701S module](https://www.displaymodule.com/products/2-1-inch-round-ips-display-480x480-500nits-all-view-transflective-with-spi-rgb) · [3.4″ square 480×480 (GC9503) alt](https://www.buydisplay.com/square-3-4-inch-480x480-ips-tft-lcd-display-spi-rgb-interface)
