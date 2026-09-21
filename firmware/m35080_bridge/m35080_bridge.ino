/*
 * M35080 BRIDGE - Arduino UNO firmware
 * ====================================
 *
 * A THIN SPI BRIDGE. This firmware deliberately contains NO odometer, VIN or
 * backup logic: it executes exactly one SPI operation per received frame and
 * reports the chip's raw status. All decision-making lives in the WebUI, which
 * talks to this sketch over USB serial (Web Serial API).
 *
 * This replaces the all-in-one sketch from gerchanovsky/m35080_odometer_fix,
 * whose VIN and mileage were compiled in as #defines. The SPI primitives below
 * are carried over from that sketch essentially unchanged - they are proven.
 *
 * WIRING (M35080 is NOT the standard 25xx pinout - check every pin):
 *
 *   M35080 pin  signal              UNO
 *   1  VSS      ground              GND
 *   2  S        chip select         D10
 *   3  W        write protect       D9
 *   4  Q        data out  (MISO)    D12
 *   5  NC       - no HOLD pin -     leave open
 *   6  C        clock     (SCK)     D13
 *   7  D        data in   (MOSI)    D11
 *   8  VCC      +5V                 5V
 *
 *   Add 0.1uF across pins 8-1 close to the chip, and a 10k pull-up on S.
 *
 * PROTOCOL (little-endian for every multi-byte protocol field):
 *   request   SOF | CMD | LEN(2) | payload           | CRC16(2)
 *   response  SOF | CMD | STATUS | LEN(2) | payload  | CRC16(2)
 *   CRC-16/CCITT-FALSE over everything after SOF, excluding the CRC itself.
 *
 * The chip wants big-endian addresses and counter values; that conversion
 * happens here, at the single point that talks SPI, so the host only ever
 * deals with one byte order.
 */

#include <stdint.h>
#include <SPI.h>

/* ------------------------------ wiring ---------------------------------- */

#define WE       9   // W  - write protect (active low)
#define CS      10   // S  - chip select   (active low)
#define DATAOUT 11   // D  - MOSI
#define DATAIN  12   // Q  - MISO
#define SCLK    13   // C  - SCK

#define CS_ENABLE     digitalWrite(CS, LOW)
#define CS_DISABLE    digitalWrite(CS, HIGH)
#define WRITE_ENABLE  digitalWrite(WE, LOW)
#define WRITE_DISABLE digitalWrite(WE, HIGH)

// 1 MHz, not the rated 5 MHz. At 3 MHz a bench read of a real chip differed from a commercial programmer's dump of that SAME chip on 3 of 1024 bytes - two of them 0xFF where data lived. Jumper wires and breadboard contacts are not a PCB, and for a 1 KB image the serial link dominates the time, so this margin is free.
static const SPISettings spiSettings(1000000, MSBFIRST, SPI_MODE0);

/* --------------------------- M35080 opcodes ------------------------------ */

#define OP_WREN   0x06  // set write enable latch
#define OP_WRDI   0x04  // reset write enable latch
#define OP_RDSR   0x05  // read status register
#define OP_READ   0x03  // read from array
#define OP_WRITE  0x02  // write to standard array
#define OP_WRINC  0x07  // write to secure/incremental array

/*
 * The byte clocked out on D while the CHIP is driving Q.
 *
 * The chip ignores D during a data phase, so this value is free - and it is
 * worth choosing deliberately. It used to be 0x00, which made a floating MISO
 * line (which reads 0x00) indistinguishable from a working D11->D12 loopback,
 * so the one test meant to separate "Arduino side" from "chip side" returned
 * the same 1024 zero bytes either way. That cost a bench session.
 *
 * 0xA5 cannot be produced by a stuck-low line (0x00), a stuck-high line (0xFF),
 * or a half-charged floating one (0x0F / 0x7F as it crosses the threshold), and
 * its alternating bits only survive if the clock is actually running. So a read
 * of A5 A5 A5... now means exactly one thing: D is reaching Q's wire directly.
 */
#define SPI_DUMMY 0xA5

#define SR_SRWD (1 << 7)
#define SR_UV   (1 << 6)  // chip has been erased
#define SR_INC  (1 << 4)  // incremental write FAILED
#define SR_WEL  (1 << 1)  // write enable latch
#define SR_WIP  (1 << 0)  // write in progress

/* ------------------------- protocol constants ---------------------------- */

#define SOF               0x7E
#define PROTOCOL_VERSION  1
#define FW_MAJOR          1
#define FW_MINOR          0

#define CMD_PING      0x01
#define CMD_RDSR      0x02
#define CMD_WREN      0x03
#define CMD_WRDI      0x04
#define CMD_READ      0x05
#define CMD_WRITE     0x06
#define CMD_WRINC     0x07
#define CMD_IDENTIFY  0x08

#define ST_OK                 0x00
#define ST_ERR_CRC            0x01
#define ST_ERR_UNKNOWN_CMD    0x02
#define ST_ERR_LENGTH         0x03
#define ST_ERR_RANGE          0x04
#define ST_ERR_WRITE_DISABLED 0x05
#define ST_ERR_INC_REFUSED    0x06
#define ST_ERR_TIMEOUT        0x07

#define IMAGE_SIZE       1024  // 8 Kbit = 0x000-0x3FF
#define SECURE_END       0x1F  // secure/incremental area is 0x00-0x1F
#define PAGE_SIZE        32    // 32 pages of 32 bytes

/*
 * These look like one number and are three.
 *
 * MAX_READ_CHUNK is bounded by this sketch's SRAM. MAX_WRITE_CHUNK is bounded
 * by the chip's PAGE: a write that crosses a page boundary wraps around within
 * the page instead of advancing, silently corrupting data. Only the read side
 * may ever grow. Never merge them.
 */
#define MAX_READ_CHUNK   128
#define MAX_WRITE_CHUNK  PAGE_SIZE
#define MAX_PAYLOAD      192

/* A load-time invariant beats a runtime check: a bad constant fails the BUILD
   rather than being discovered after the first byte reached the chip. */
#if MAX_WRITE_CHUNK > PAGE_SIZE
#error "MAX_WRITE_CHUNK exceeds the page size - a page-crossing write corrupts data"
#endif
#if MAX_READ_CHUNK > MAX_PAYLOAD
#error "MAX_READ_CHUNK does not fit in MAX_PAYLOAD"
#endif
#if (MAX_WRITE_CHUNK + 2) > MAX_PAYLOAD
#error "a WRITE request (address + data) does not fit in MAX_PAYLOAD"
#endif

#define WIP_TIMEOUT_MS  100   // a page program is ~5ms; 100 is generous
#define FRAME_TIMEOUT_MS 250  // mid-frame byte gap before we give up and resync

static uint8_t g_payload[MAX_PAYLOAD];

/* --------------------------------- CRC ----------------------------------- */

static uint16_t crc16_update(uint16_t crc, const uint8_t *data, uint16_t len) {
  while (len--) {
    crc ^= (uint16_t)(*data++) << 8;
    for (uint8_t i = 0; i < 8; i++) {
      crc = (crc & 0x8000) ? (uint16_t)((crc << 1) ^ 0x1021) : (uint16_t)(crc << 1);
    }
  }
  return crc;
}

/* --------------------- SPI primitives (from the reference) ---------------- */

static uint8_t read_status() {
  SPI.beginTransaction(spiSettings);
  CS_ENABLE;
  SPI.transfer(OP_RDSR);
  uint8_t value = SPI.transfer(SPI_DUMMY);
  CS_DISABLE;
  SPI.endTransaction();
  return value;
}

static void read_buf(uint16_t address, uint8_t *buffer, uint16_t size) {
  SPI.beginTransaction(spiSettings);
  CS_ENABLE;
  SPI.transfer(OP_READ);
  SPI.transfer16(address);            // chip wants big-endian; transfer16 does that
  while (size-- > 0) *buffer++ = SPI.transfer(SPI_DUMMY);
  CS_DISABLE;
  SPI.endTransaction();
}

/*
 * Opens a write: drops W, latches WREN, confirms WEL actually set, and leaves
 * the SPI transaction + CS open so the caller can send its opcode and data.
 * Returns ST_OK, or ST_ERR_WRITE_DISABLED when the latch refused to set
 * (which is what a hardware-write-protected chip looks like).
 */
static uint8_t begin_write() {
  WRITE_ENABLE;
  SPI.beginTransaction(spiSettings);
  CS_ENABLE;
  SPI.transfer(OP_WREN);
  CS_DISABLE;
  SPI.endTransaction();
  delay(10);
  if ((read_status() & SR_WEL) == 0) {
    WRITE_DISABLE;
    return ST_ERR_WRITE_DISABLED;
  }
  SPI.beginTransaction(spiSettings);
  CS_ENABLE;
  return ST_OK;
}

/*
 * Closes a write: waits for the self-timed cycle to finish, then clears the
 * latch and re-asserts write protect.
 *
 * The reference sketch spun on WIP forever; a missing or dead chip hung the
 * board. Bounded here, reported as ST_ERR_TIMEOUT.
 *
 * When `inc` is set we also report the chip's INC bit, which it raises when a
 * WRINC value was not greater than what was stored. Note a stale INC from an
 * earlier refusal would also surface - that fails closed (the host treats
 * INC_REFUSED as non-retriable), which is the safe direction.
 */
static uint8_t end_write(bool inc) {
  CS_DISABLE;
  SPI.endTransaction();
  delay(10);

  uint8_t status;
  uint32_t t0 = millis();
  do {
    status = read_status();
    if ((uint32_t)(millis() - t0) > WIP_TIMEOUT_MS) {
      WRITE_DISABLE;
      return ST_ERR_TIMEOUT;
    }
  } while (status & SR_WIP);

  uint8_t result = ST_OK;
  if (inc && (status & SR_INC)) result = ST_ERR_INC_REFUSED;

  SPI.beginTransaction(spiSettings);
  CS_ENABLE;
  SPI.transfer(OP_WRDI);
  CS_DISABLE;
  SPI.endTransaction();
  WRITE_DISABLE;
  return result;
}

static uint8_t write_buf(uint16_t address, const uint8_t *buffer, uint16_t size) {
  uint8_t st = begin_write();
  if (st != ST_OK) return st;
  SPI.transfer(OP_WRITE);
  SPI.transfer16(address);
  while (size-- > 0) SPI.transfer(*buffer++);
  return end_write(false);
}

static uint8_t write_secure(uint16_t address, uint16_t value) {
  uint8_t st = begin_write();
  if (st != ST_OK) return st;
  SPI.transfer(OP_WRINC);
  SPI.transfer16(address);
  SPI.transfer((uint8_t)(value >> 8));   // the counter is big-endian on the chip
  SPI.transfer((uint8_t)(value & 0xFF));
  return end_write(true);
}

/* ------------------------------- framing --------------------------------- */

static bool read_exact(uint8_t *buf, uint16_t n, uint32_t timeout_ms) {
  uint32_t t0 = millis();
  uint16_t got = 0;
  while (got < n) {
    if (Serial.available()) {
      buf[got++] = (uint8_t)Serial.read();
      t0 = millis();
    } else if ((uint32_t)(millis() - t0) > timeout_ms) {
      return false;
    }
  }
  return true;
}

static void send_response(uint8_t cmd, uint8_t status,
                          const uint8_t *payload, uint16_t len) {
  uint8_t head[4];
  head[0] = cmd;
  head[1] = status;
  head[2] = (uint8_t)(len & 0xFF);
  head[3] = (uint8_t)(len >> 8);

  uint16_t crc = crc16_update(0xFFFF, head, 4);
  if (len) crc = crc16_update(crc, payload, len);

  Serial.write((uint8_t)SOF);
  Serial.write(head, 4);
  if (len) Serial.write(payload, len);
  Serial.write((uint8_t)(crc & 0xFF));
  Serial.write((uint8_t)(crc >> 8));
  Serial.flush();
}

static void send_status(uint8_t cmd, uint8_t status) {
  send_response(cmd, status, NULL, 0);
}

/** One byte of chip status as the payload - the common "did it work" reply. */
static void send_status_with_sr(uint8_t cmd, uint8_t status) {
  uint8_t sr = read_status();
  send_response(cmd, status, &sr, 1);
}

/* ------------------------------ commands --------------------------------- */

static void cmd_ping() {
  uint8_t p[19];
  memcpy_P(p, PSTR("M35080BR"), 8);
  p[8]  = PROTOCOL_VERSION;
  p[9]  = FW_MAJOR;
  p[10] = FW_MINOR;
  // The bridge PUBLISHES ITS OWN LIMITS. The host reads these rather than
  // assuming, so a firmware built with a smaller buffer stays correct.
  p[11] = (uint8_t)(MAX_READ_CHUNK & 0xFF);  p[12] = (uint8_t)(MAX_READ_CHUNK >> 8);
  p[13] = (uint8_t)(MAX_WRITE_CHUNK & 0xFF); p[14] = (uint8_t)(MAX_WRITE_CHUNK >> 8);
  p[15] = (uint8_t)(PAGE_SIZE & 0xFF);       p[16] = (uint8_t)(PAGE_SIZE >> 8);
  p[17] = (uint8_t)(IMAGE_SIZE & 0xFF);      p[18] = (uint8_t)(IMAGE_SIZE >> 8);
  send_response(CMD_PING, ST_OK, p, sizeof(p));
}

static void cmd_read(const uint8_t *payload, uint16_t len) {
  if (len != 4) { send_status(CMD_READ, ST_ERR_LENGTH); return; }
  uint16_t address = (uint16_t)payload[0] | ((uint16_t)payload[1] << 8);
  uint16_t count   = (uint16_t)payload[2] | ((uint16_t)payload[3] << 8);
  if (count == 0 || count > MAX_READ_CHUNK ||
      (uint32_t)address + count > IMAGE_SIZE) {
    send_status(CMD_READ, ST_ERR_RANGE);
    return;
  }
  read_buf(address, g_payload, count);
  send_response(CMD_READ, ST_OK, g_payload, count);
}

static void cmd_write(const uint8_t *payload, uint16_t len) {
  if (len < 3) { send_status(CMD_WRITE, ST_ERR_LENGTH); return; }
  uint16_t address = (uint16_t)payload[0] | ((uint16_t)payload[1] << 8);
  uint16_t count   = len - 2;

  if (count > MAX_WRITE_CHUNK) { send_status(CMD_WRITE, ST_ERR_LENGTH); return; }
  if ((uint32_t)address + count > IMAGE_SIZE) {
    send_status(CMD_WRITE, ST_ERR_RANGE);
    return;
  }
  // The secure area is reachable only through WRINC; a plain WRITE there is a
  // programming error, so refuse it rather than letting the chip decide.
  if (address <= SECURE_END) { send_status(CMD_WRITE, ST_ERR_RANGE); return; }
  // Defence in depth: the host already splits on page boundaries.
  if ((address / PAGE_SIZE) != ((address + count - 1) / PAGE_SIZE)) {
    send_status(CMD_WRITE, ST_ERR_RANGE);
    return;
  }
  send_status_with_sr(CMD_WRITE, write_buf(address, payload + 2, count));
}

static void cmd_wrinc(const uint8_t *payload, uint16_t len) {
  if (len != 4) { send_status(CMD_WRINC, ST_ERR_LENGTH); return; }
  uint16_t address = (uint16_t)payload[0] | ((uint16_t)payload[1] << 8);
  uint16_t value   = (uint16_t)payload[2] | ((uint16_t)payload[3] << 8);
  if (address > SECURE_END || (address & 1)) {
    send_status(CMD_WRINC, ST_ERR_RANGE);
    return;
  }
  send_status_with_sr(CMD_WRINC, write_secure(address, value));
}

static void cmd_identify() {
  g_payload[0] = read_status();
  read_buf(0x000, g_payload + 1, 32);   // the whole secure area
  send_response(CMD_IDENTIFY, ST_OK, g_payload, 33);
}

static void dispatch(uint8_t cmd, const uint8_t *payload, uint16_t len) {
  switch (cmd) {
    case CMD_PING:     cmd_ping(); break;
    case CMD_RDSR:     send_status_with_sr(CMD_RDSR, ST_OK); break;
    case CMD_IDENTIFY: cmd_identify(); break;
    case CMD_READ:     cmd_read(payload, len); break;
    case CMD_WRITE:    cmd_write(payload, len); break;
    case CMD_WRINC:    cmd_wrinc(payload, len); break;
    case CMD_WREN: {
      uint8_t st = begin_write();
      if (st == ST_OK) { CS_DISABLE; SPI.endTransaction(); }
      send_status_with_sr(CMD_WREN, st);
      break;
    }
    case CMD_WRDI: {
      SPI.beginTransaction(spiSettings);
      CS_ENABLE;
      SPI.transfer(OP_WRDI);
      CS_DISABLE;
      SPI.endTransaction();
      WRITE_DISABLE;
      send_status_with_sr(CMD_WRDI, ST_OK);
      break;
    }
    default: send_status(cmd, ST_ERR_UNKNOWN_CMD); break;
  }
}

/* -------------------------------- main ----------------------------------- */

void setup() {
  pinMode(CS, OUTPUT);
  pinMode(SCLK, OUTPUT);
  pinMode(DATAOUT, OUTPUT);
  pinMode(DATAIN, INPUT);
  digitalWrite(CS, HIGH);
  digitalWrite(SCLK, HIGH);
  pinMode(WE, OUTPUT);
  WRITE_DISABLE;          // writes are protected until a command asks for one

  SPI.begin();
  Serial.begin(115200);
}

void loop() {
  // Hunt for SOF. Anything else is stream noise or the tail of a frame we lost.
  int b = Serial.read();
  if (b != SOF) return;

  uint8_t head[3];                       // cmd, len_lo, len_hi
  if (!read_exact(head, 3, FRAME_TIMEOUT_MS)) return;

  uint16_t len = (uint16_t)head[1] | ((uint16_t)head[2] << 8);
  if (len > MAX_PAYLOAD) {               // validate before trusting the length
    send_status(head[0], ST_ERR_LENGTH);
    return;
  }

  if (len && !read_exact(g_payload, len, FRAME_TIMEOUT_MS)) return;

  uint8_t crcbuf[2];
  if (!read_exact(crcbuf, 2, FRAME_TIMEOUT_MS)) return;

  uint16_t crc = crc16_update(0xFFFF, head, 3);
  if (len) crc = crc16_update(crc, g_payload, len);
  uint16_t want = (uint16_t)crcbuf[0] | ((uint16_t)crcbuf[1] << 8);
  if (crc != want) {
    send_status(head[0], ST_ERR_CRC);    // host may safely re-send this frame
    return;
  }

  dispatch(head[0], g_payload, len);
}
