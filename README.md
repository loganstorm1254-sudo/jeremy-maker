# Jeremy Maker (Vercel zip)

Micro:bit-style programmer for **Jeremy Bot**. Right now you can change what happens when the **switch is flicked**: screen text + which lights turn on. Plug the ESP32 in over USB and download.

## Deploy to Vercel

1. Unzip this folder.
2. Vercel → Add New Project → upload / import this directory (or `vercel deploy`).
3. Root directory = this folder (static files). No build command needed.
4. Open the site in **Chrome or Edge** (Web Serial).

## One-time firmware

Flash **BOT_CODE 2.6.42+** to the board with Arduino IDE first (USB serial programmer lives in that firmware).

## Use

1. Open the Maker site.
2. Edit **when switch flicked** → screen text + Blue / Red / Yellow.
3. Plug Jeremy in → **Find plugged-in Jeremy** → pick the serial port.
4. **Download to Jeremy** — program is saved on-device (survives reboot).

## Protocol (USB 115200)

| Host → device | Device → host |
|---------------|---------------|
| `HELLO` | `JEREMY_OK\|2.6.42` |
| `GETSWITCH` | `SWITCH\|text\|B\|R\|Y` |
| `SETSW\|B\|R\|Y\|text` | `OK\|text` |
