# Jeremy Studio

Desktop programmer for **Jeremy** units. Design the idle face (eye shape, pupils, corner labels), set the switch program and lights, then download over USB.

## Deploy (Vercel)

1. Import this folder as a static project (no build command).
2. Open in **Chrome or Edge** (Web Serial required).

## Firmware

Flash **BOT_CODE 2.6.52+** once with Arduino IDE, then **close Serial Monitor** before connecting Studio.

## USB protocol (115200)

| Host → device | Device → host |
|---------------|---------------|
| `HELLO` | `JEREMY_OK\|2.6.50` |
| `GETLOOK` | `LOOK\|shape\|pupil\|size\|tl\|tr\|bl\|br\|uptime` |
| `SETLOOK\|…` | `LOOKOK\|version` |
| `GETSWITCH` | `SWITCH\|text\|B\|R\|Y` |
| `SETSW\|B\|R\|Y\|text` | `OK\|text` |

Eye shapes: 0 circle · 1 square · 2 soft · 3 wide · 4 tall · 5 diamond  
Pupils: 0 none · 1 dot · 2 ring · 3 bar · 4 cross · 5 spark
