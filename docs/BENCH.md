# Bench — testing a cluster out of the car

TEST runs a cluster on the desk after its chip has been moved or restored: move the needles,
light the lamps one at a time, read back what the cluster itself thinks its VIN and mileage are,
and read its EEPROM through the cluster to compare with the chip image. It talks to the cluster
over DS2 through the **K+DCAN cable** you already use on the car. The Arduino UNO is not part of
this bench — it only ever talks to a chip on a breadboard.

The wiring below is the one source the app draws from: `web/lib/domain/clusterBench.ts`.
`web/test/bench.test.ts` reads the table in this file and fails when the two disagree.

## ⚠ The cluster pin numbers are unverified

The X11175 pin numbers, where they sit in the connector and the colours of their wires come from
one public source for the E46 cluster connector:
[bmwgm5](https://www.bmwgm5.com/E46_IKE_Connections.htm) — its pinout table and its photo of the
board. They have **not** been checked on a real cluster by this project. The app marks every
cluster pin UNVERIFIED until they have been. Before powering anything, check each pin against
your own cluster's connector and a wiring diagram you trust, with a meter.

The OBD-II side is the J1962 standard and is not in question.

## The cluster connector

X11175 is 26 pins in two columns of 13. Seen from the back of the cluster, as in bmwgm5's photo
of the board, 1–13 run up the right-hand column from the bottom and 14–26 up the left-hand one,
so pin *n* sits beside pin *n* + 13. The bench uses five of them. Each wire's colour, in BMW's
letters with the base colour first, is how it is found in a pigtail cut from a used harness
(SW black, BR brown, RT red, GE yellow, GN green, BL blue, VI violet, WS white).

| Pin | Signal | Wire |
|---|---|---|
| 1 | GND | BR/SW |
| 4 | KL30 | RT/GE/WS |
| 5 | KL15 | GN/BL |
| 6 | KL R | VI/GE |
| 25 | TXD1 | WS/VI |

```
 X11175 from the back of the cluster
   26   13
  [25]  12
   24   11
   23   10
   22    9
   21    8
   20    7
   19   [6]   KL R
   18   [5]   KL15
   17   [4]   KL30
   16    3
   15    2
   14   [1]   GND
```

## Built like a breadboard

Every joint on this bench is a **lever connector** (WAGO 221 or similar): lift the lever, push the
stripped end in, close it. A lever connector is one node, the way a breadboard's rail is — a wire
in any of its ports is on that node — and its test slot takes a meter probe. Three do the whole
bench: fused +12 V (5 ports), ground (5 ports), and a 2-port one that joins the cable's K-line to
the cluster's. The fuse holder's leads and the loose ends of the two pigtails go straight in:
nothing is soldered, crimped or screwed down.

**No ignition switch.** KL15 and KL R go on the fused +12 V with KL30, so the supply's output is
the key: switched on, the cluster sees battery and ignition together, as with the key turned.
Nothing TEST does needs the ignition off with the battery on. To switch off, STOP the session
first, then the supply's output.

## Bill of materials

| Item | Note |
|---|---|
| 12 V bench supply, **1 A or more** | Current-limited is best: set the limit near 1 A |
| Inline fuse holder with leads + **1 A fuse** | In the feed, before everything else |
| Lever connector, 5 ports (WAGO 221-415 or similar), two | One for fused +12 V, one for ground |
| Lever connector, 2 ports (WAGO 221-412 or similar) | Joins OBD 7 to cluster pin 25 |
| OBD-II 16-pin **female** socket with leads | The K+DCAN cable plugs into it, as into the car |
| Mating plug for the cluster connector X11175 (black, 26 pins) | A pigtail cut from a used harness. **Do not solder to the cluster's board.** |
| Hookup wire | PSU − to the ground connector |
| K+DCAN cable | The one you use on the car |
| Multimeter | To check pins, polarity and the fuse before power |

## Wiring

| Wire | From | To | Carries |
|---|---|---|---|
| feed | PSU + | +12 V FUSED | the supply, through the 1 A fuse |
| ground-lead | PSU - | GND | ground |
| kl30 | +12 V FUSED | X11175 4 | KL30, permanent + |
| kl15 | +12 V FUSED | X11175 5 | KL15, ignition — on with the supply |
| klr | +12 V FUSED | X11175 6 | KL R, accessory — on with the supply |
| cluster-gnd | GND | X11175 1 | cluster ground |
| obd-16 | +12 V FUSED | OBD 16 | the cable's supply |
| obd-4 | GND | OBD 4 | the cable's ground |
| obd-5 | GND | OBD 5 | the cable's signal ground |
| obd-7 | K-LINE | OBD 7 | the cable's K-line |
| k-line | K-LINE | X11175 25 | DS2 (TXD1) |
| usb | K+DCAN | PC | Web Serial, 9600 8E1 |

```
 PSU + ──[1 A]──► [ +12 V FUSED · 5 ports ] ──┬──► X11175 4   (KL30)
                                              ├──► X11175 5   (KL15)
                                              ├──► X11175 6   (KL R)
                                              └──► OBD 16
 PSU − ─────────► [ GND · 5 ports ] ──────────┬──► X11175 1   (GND)
                                              ├──► OBD 4
                                              └──► OBD 5      (one port spare)
 OBD 7 ─────────► [ K-LINE · 2 ports ] ───────────► X11175 25  (TXD1)
 K+DCAN, plugged into the OBD socket ──USB──► PC

 OBD-II socket, seen from the plug-in side, wide edge up - SAE J1962's vehicle connector mating end
 view (its back, and the cable's plug seen face on, are mirrored: 1 top right, 16 bottom left)
  ┌──────────────────────────────┐
   \  1  2  3 [4][5] 6 [7] 8     /
    \  9 10 11 12 13 14 15 [16] /
     └─────────────────────────┘
```

The OBD socket is drawn from the plug-in side with its wide edge up — the J1962 face: pins 1–8
across the top, 9–16 across the bottom, left to right. **From the back, where a pigtail's wires
leave, left and right swap:** 16 becomes 9 and 7 becomes 2, and the cable is left with no supply
and no K-line - the cluster still lights, and CONNECT times out. Identify every pigtail wire by
continuity from the socket's front contacts, never by its colour or by counting from the back.
The cluster connector is drawn as above, from
the back of the cluster, beside a list of the five wires it uses; the wires land on the list.
Which port of a lever connector a wire takes does not matter; the app's drawing picks one so the
wires do not cross more than they must.

**OBD 7, not 8.** The E46 has two diagnostic lines: OBD 7 is D_TXD2, for the engine and gearbox,
and OBD 8 is D_TXD1, for everything else — the cluster among them (X11175 pin 25 is D_TXD1). A
K+DCAN cable talks on 7, the J1962 K-line, and its switch in the K-line position bridges 7 and 8:
that "7–8 bridge" is how it reaches the cluster in the car. On the bench the cluster is the only
thing on the line, so its pin 25 goes straight to OBD 7, and OBD 8 is not wired. Leaving the switch
where it sits on the car does no harm: the bridge then only joins 7 to a pin that goes nowhere.

## Procedure

Each step says what to do and how you know it is done.

1. **Parts.** Everything above on the desk, the fuse in its holder, the supply off.
   *Done when* every required part is at hand.
2. **Supply.** One lead of the fuse holder to PSU +, the other into the +12 V connector; one wire
   from PSU − into the ground connector.
   *Done when* with the supply on and nothing else connected, the +12 V connector reads 12 V to
   the ground connector — and 0 V with the fuse out.
3. **Cluster plug.** On the pigtail — never on the cluster's board: pins 4 (KL30), 5 (KL15) and
   6 (KL R) into the +12 V connector, pin 1 into the ground connector. Insulate the ends you do
   not use. Check each pin number on your own cluster first.
   *Done when* with the supply off, a meter shows each plug pin connected to its connector and no
   path between +12 V and ground.
4. **OBD socket.** Number the socket's holes from the cable's plug: hold it face to face as it
   goes in, and the hole its pin 16 enters is 16 - no drawing and no molding to misread. Find
   which pigtail wire reaches which hole with a meter. 16 into +12 V, 4 and 5 into ground; 7 and
   cluster pin 25 meet in the 2-port connector. Insulate the ends you do not use.
   *Done when* with the supply on, hole 16 reads 12 V to holes 4 and 5, and hole 7 has continuity
   to cluster pin 25.
5. **K+DCAN.** Plug the cable into the socket, its switch where it sits on your E46 (K-line),
   USB to the PC.
   *Done when* the PC lists the cable's USB serial port.
6. **Power on.** Supply output on: KL30, KL15 and KL R come on together, as with the key turned.
   To switch off, STOP the session first, then the output.
   *Done when* the cluster lights up, runs its bulb check, and the fuse holds.
7. **CONNECT.** In the TEST tab, choose the cable's port.
   *Done when* TEST shows IDENT's bytes and a variant (KOMBI46, KOMBI46R or KOMBIR40).

## Cautions

- **Check the pin numbers on your own cluster.** See the warning at the top.
- **Check the polarity** at both connectors before connecting the cluster plug.
- **Always fit the fuse.** It is the only thing between a miswire and the cluster.
- **Number the OBD holes from the cable's plug.** Counted from the socket's back, or read off the
  plug's own face, they are mirrored.
- **Insulate the pigtail ends you do not use.** A loose end that touches +12 V feeds a cluster
  input that was never meant to see it, and no fuse stops that.
- **Never connect the UNO to the cluster.** TEST refuses the UNO's port (USB vendor 0x2341).
- With no CAN partners on the bench, some warning lamps may stay lit. That is the bench, not a
  fault; TEST's lamp check lights each lamp on command and asks whether you saw it.

## What the first bench session confirms

Everything TEST sends is read out of BMW's own tester logic (the KOMBI46 / KOMBI46R SGBDs and the
group file D_0080.grp) — strong evidence, not a measurement. The first session on a real cluster
settles, in this order:

1. The X11175 pin numbers above (then `verified` becomes true in `clusterBench.ts`).
2. IDENT: the diagnosis index, and so the variant the app names. The first cluster on the bench
   (2026-09-26) answered 0x54, which D_0080.grp gives to KOMBIR40 - not to either E46 SGBD - and a
   part-number field that is not BCD. TEST speaks KOMBIR40's telegrams to it: four
   needles, seven lamp bytes, and the KOMBI46-shaped EEPROM and input reads; no gong, piezo or
   output port.
3. Which chip field the cluster reports as its VIN — the coded field at 0x07A, or the ASCII one.
4. The mileage the cluster reports, against the chip's counter.
5. The needles, the lamps (each bit against the lamp that lit) and the gong.
6. The EEPROM read: how the cluster's word addresses land on the chip's byte addresses. The app
   assumes word *w* is chip bytes 2*w* and 2*w*+1, and says so wherever it compares.
