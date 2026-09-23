# Jeremy Maker

Micro:bit-style programmer for Jeremy Bot. Edit **when switch flicked** (screen text + lights), plug the ESP32 in over USB, download.

## Deploy on Vercel

1. Import this repo in [Vercel](https://vercel.com/new)
2. Framework preset: **Other** (static)
3. Root directory: `.`
4. Build command: leave empty
5. Output directory: `.` (or leave default)
6. Deploy → open in **Chrome/Edge** (needs Web Serial)

## One-time firmware

Flash **BOT_CODE 2.6.41+** to the board with Arduino IDE first.

## Local

Open `index.html` via any static server, or:

```bash
npx serve .
```
