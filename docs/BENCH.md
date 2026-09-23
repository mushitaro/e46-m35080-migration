# Bench — testing a cluster out of the car

TEST runs a cluster on the desk after its chip has been moved or restored: move the needles,
light the lamps one at a time, read back what the cluster itself thinks its VIN and mileage are,
and read its EEPROM through the cluster to compare with the chip image. It talks to the cluster
over DS2 through the **K+DCAN cable** you already use on the car. The Arduino UNO is not part of
this bench — it only ever talks to a chip on a breadboard.

The wiring below is the one source the app draws from: `web/lib/domain/clusterBench.ts`.
`web/test/bench.test.ts` reads the table in this file and fails when the two disagree.

## ⚠ The cluster pin numbers are unverified

The X11175 pin numbers come from one public pinout of the E46 cluster connector (bmwgm5). They
have **not** been checked on a real cluster by this project. The app marks every cluster pin
UNVERIFIED until they have been. Before powering anything, check each pin against your own
cluster's connector and a wiring diagram you trust, with a meter.

The OBD-II side is the J1962 standard and is not in question.

## Bill of materials

| Item | Note |
|---|---|
| 12 V bench supply, **1 A or more** | Current-limited is best: set the limit near 1 A |
| Inline fuse holder + **1 A fuse** | In the feed, before everything else |
| Toggle switch | KL15 (ignition) |
| OBD-II 16-pin **female** socket (breakout) | The K+DCAN cable plugs into it, as into the car |
| Mating plug for the cluster connector X11175 (black, 26 pins) | A pigtail cut from a used harness. **Do not solder to the cluster's board.** |
| Hookup wire, terminal blocks | One block for fused +12 V, one for switched, one for ground |
| K+DCAN cable | The one you use on the car |
| Multimeter | To check pins, polarity and the fuse before power |

## Wiring

| Wire | From | To | Carries |
|---|---|---|---|
| feed | PSU + | +12 V FUSED | the supply, through the 1 A fuse |
| ground-lead | PSU - | GND | ground |
| switch | +12 V FUSED | KL15 SWITCHED | through the toggle switch |
| kl30 | +12 V FUSED | X11175 4 | KL30, permanent + |
| kl15 | KL15 SWITCHED | X11175 5 | KL15, ignition |
| klr | KL15 SWITCHED | X11175 6 | KL R, accessory |
| cluster-gnd | GND | X11175 1 | cluster ground |
| obd-16 | +12 V FUSED | OBD 16 | the cable's supply |
| obd-4 | GND | OBD 4 | the cable's ground |
| obd-5 | GND | OBD 5 | the cable's signal ground |
| k-line | OBD 7 | X11175 25 | DS2 (K-line) |
| usb | K+DCAN | PC | Web Serial, 9600 8E1 |

```
 PSU + ──[1 A]──► +12 V FUSED ──┬──────────────► X11175 4   (KL30)
                                ├──────────────► OBD 16
                                └──[switch]────► KL15 SWITCHED ──┬──► X11175 5  (KL15)
                                                                 └──► X11175 6  (KL R)
 PSU − ─────────► GND ──────────┬──────────────► X11175 1   (GND)
                                ├──────────────► OBD 4
                                └──────────────► OBD 5
 OBD 7 (K-line) ───────────────────────────────► X11175 25  (TXD)
 K+DCAN, plugged into the OBD socket ──USB──► PC

 OBD-II socket, mating face (as the car's, under the dash)
  ┌──────────────────────────────┐
   \  1  2  3 [4][5] 6 [7] 8     /
    \  9 10 11 12 13 14 15 [16] /
     └─────────────────────────┘
```

The OBD socket is drawn as its mating face — the way you see the car's socket under the dash:
pins 1–8 across the top, 9–16 across the bottom. The cluster connector is drawn as a list,
because its physical layout has not been checked either.

## Procedure

Each step says what to do and how you know it is done.

1. **Parts.** Everything above on the desk, the fuse in its holder, the supply off.
   *Done when* every required part is at hand.
2. **Supply.** PSU + through the fuse holder to the +12 V block; PSU − to the ground block.
   *Done when* with the supply on and nothing else connected, the +12 V block reads 12 V to
   ground — and 0 V with the fuse out.
3. **Switch.** From the +12 V block through the toggle switch to the switched block.
   *Done when* the switched block reads 12 V with the switch on and 0 V with it off.
4. **Cluster plug.** Pin 4 to +12 V, pins 5 and 6 to the switched block, pin 1 to ground, on the
   mating plug — never on the cluster's board. Check each pin number on your own cluster first.
   *Done when* with the supply off, a meter shows each plug pin connected to its block and no
   path between +12 V and ground.
5. **OBD socket.** 16 to +12 V, 4 and 5 to ground, 7 to cluster pin 25.
   *Done when* OBD 16 reads 12 V to OBD 4 and 5 with the supply on, and OBD 7 has continuity to
   cluster pin 25.
6. **K+DCAN.** Plug the cable into the socket, its switch where it sits on your E46 (K-line),
   USB to the PC.
   *Done when* the PC lists the cable's USB serial port.
7. **Power on.** Supply on (KL30), then the switch (KL15).
   *Done when* the cluster lights up, runs its bulb check, and the fuse holds.
8. **CONNECT.** In the TEST tab, choose the cable's port.
   *Done when* TEST shows the cluster's part number and its variant (KOMBI46 or KOMBI46R).

## Cautions

- **Check the pin numbers on your own cluster.** See the warning at the top.
- **Check the polarity** at both blocks before connecting the cluster plug.
- **Always fit the fuse.** It is the only thing between a miswire and the cluster.
- **Never connect the UNO to the cluster.** TEST refuses the UNO's port (USB vendor 0x2341).
- With no CAN partners on the bench, some warning lamps may stay lit. That is the bench, not a
  fault; TEST's lamp check lights each lamp on command and asks whether you saw it.

## What the first bench session confirms

Everything TEST sends is read out of BMW's own tester logic (the KOMBI46 / KOMBI46R SGBDs and the
group file D_0080.grp) — strong evidence, not a measurement. The first session on a real cluster
settles, in this order:

1. The X11175 pin numbers above (then `verified` becomes true in `clusterBench.ts`).
2. IDENT: the diagnosis index, and so the variant the app names.
3. Which chip field the cluster reports as its VIN — the coded field at 0x07A, or the ASCII one.
4. The mileage the cluster reports, against the chip's counter.
5. The needles, the lamps (each bit against the lamp that lit) and the gong.
6. The EEPROM read: how the cluster's word addresses land on the chip's byte addresses. The app
   assumes word *w* is chip bytes 2*w* and 2*w*+1, and says so wherever it compares.
