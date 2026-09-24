(() => {
  const $ = (id) => document.getElementById(id);

  const canvas = $("oled");
  const ctx = canvas.getContext("2d");
  const statusLine = $("statusLine");
  const connDot = $("connDot");
  const connLabel = $("connLabel");
  const btnConnect = $("btnConnect");
  const btnFlash = $("btnFlash");
  const stageMode = $("stageMode");

  const eyeShape = $("eyeShape");
  const pupilStyle = $("pupilStyle");
  const pupilSize = $("pupilSize");
  const pupilSizeLabel = $("pupilSizeLabel");
  const cornerBL = $("cornerBL");
  const cornerBR = $("cornerBR");
  const btnDefaultEyes = $("btnDefaultEyes");
  const screenText = $("screenText");
  const ledBlue = $("ledBlue");
  const ledRed = $("ledRed");
  const ledYellow = $("ledYellow");
  const prevBlue = $("prevBlue");
  const prevRed = $("prevRed");
  const prevYellow = $("prevYellow");

  const FIRMWARE_LABEL = "2.6.52";

  /** @type {SerialPort | null} */
  let port = null;
  /** @type {ReadableStreamDefaultReader | null} */
  let reader = null;
  /** @type {WritableStreamDefaultWriter | null} */
  let writer = null;
  let readLoopActive = false;
  let lineBuffer = "";
  /** @type {Array<(line: string) => void>} */
  let lineWaiters = [];
  let previewMode = "idle";
  let uptimeTick = 0;

  const hasSerial = "serial" in navigator;

  function setStatus(msg) {
    statusLine.textContent = msg;
  }

  function setConnected(on, label) {
    connDot.classList.toggle("on", on);
    connLabel.textContent = label;
    btnFlash.disabled = !on;
  }

  function scrub(s, max) {
    return String(s || "")
      .replace(/\|/g, " ")
      .replace(/[\r\n]+/g, " ")
      .trim()
      .slice(0, max);
  }

  function readState() {
    return {
      eyeShape: Number(eyeShape.value) || 0,
      pupilStyle: Number(pupilStyle.value) || 0,
      pupilSize: Number(pupilSize.value) || 4,
      cornerTL: "",
      cornerTR: "",
      cornerBL: scrub(cornerBL.value, 8),
      cornerBR: scrub(cornerBR.value, 8),
      showUptime: true,
      screenText: scrub(screenText.value, 32) || "JEREMY CO",
      ledBlue: ledBlue.checked,
      ledRed: ledRed.checked,
      ledYellow: ledYellow.checked,
    };
  }

  function applyState(s) {
    if (s.eyeShape != null) eyeShape.value = String(s.eyeShape);
    if (s.pupilStyle != null) pupilStyle.value = String(s.pupilStyle);
    if (s.pupilSize != null) pupilSize.value = String(s.pupilSize);
    if (s.cornerBL != null) cornerBL.value = s.cornerBL;
    if (s.cornerBR != null) cornerBR.value = s.cornerBR;
    if (s.screenText != null) screenText.value = s.screenText;
    if (s.ledBlue != null) ledBlue.checked = !!s.ledBlue;
    if (s.ledRed != null) ledRed.checked = !!s.ledRed;
    if (s.ledYellow != null) ledYellow.checked = !!s.ledYellow;
    pupilSizeLabel.textContent = pupilSize.value;
    syncPreview();
  }

  function setDefaultEyes() {
    eyeShape.value = "2";
    pupilStyle.value = "0";
    pupilSize.value = "4";
    pupilSizeLabel.textContent = "4";
    syncPreview();
    setStatus("Default factory eyes selected.");
  }

  function drawEye(cx, cy, size, shape, pupil, pSize) {
    const half = size / 2;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    if (shape === 0) {
      ctx.arc(cx, cy, half, 0, Math.PI * 2);
      ctx.fill();
    } else if (shape === 1) {
      ctx.fillRect(cx - half, cy - half, size, size);
    } else if (shape === 3) {
      roundRect(cx - half - 4, cy - half + 2, size + 8, size - 4, 5);
      ctx.fill();
    } else if (shape === 4) {
      roundRect(cx - half + 2, cy - half - 2, size - 4, size + 4, 5);
      ctx.fill();
    } else if (shape === 5) {
      ctx.moveTo(cx, cy - half);
      ctx.lineTo(cx + half, cy);
      ctx.lineTo(cx, cy + half);
      ctx.lineTo(cx - half, cy);
      ctx.closePath();
      ctx.fill();
    } else {
      roundRect(cx - half, cy - half, size, size, 8);
      ctx.fill();
    }

    if (pupil === 0) return;
    ctx.fillStyle = "#000";
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1.5;
    const ps = pSize;
    if (pupil === 1) {
      ctx.beginPath();
      ctx.arc(cx, cy, ps, 0, Math.PI * 2);
      ctx.fill();
    } else if (pupil === 2) {
      ctx.beginPath();
      ctx.arc(cx, cy, ps, 0, Math.PI * 2);
      ctx.stroke();
    } else if (pupil === 3) {
      ctx.fillRect(cx - ps, cy - 1, ps * 2, 3);
    } else if (pupil === 4) {
      ctx.fillRect(cx - ps, cy - 1, ps * 2, 3);
      ctx.fillRect(cx - 1, cy - ps, 3, ps * 2);
    } else if (pupil === 5) {
      ctx.beginPath();
      ctx.moveTo(cx - ps, cy);
      ctx.lineTo(cx + ps, cy);
      ctx.moveTo(cx, cy - ps);
      ctx.lineTo(cx, cy + ps);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(1, ps / 2), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function roundRect(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function drawCorner(text, x, y, align) {
    if (!text) return;
    ctx.fillStyle = "#fff";
    ctx.font = "8px monospace";
    ctx.textBaseline = "top";
    ctx.textAlign = align;
    ctx.fillText(text, x, y);
  }

  function formatUptime(sec) {
    const hrs = Math.floor(sec / 3600);
    const mins = Math.floor(sec / 60) % 60;
    const secs = sec % 60;
    if (hrs > 0) return `${hrs}h${mins}m`;
    if (mins > 0) return `${mins}m${secs}s`;
    return `${secs}s`;
  }

  function wrapText(text, maxCols, maxLines) {
    const lines = [];
    let row = "";
    for (const ch of text) {
      if (row.length >= maxCols) {
        lines.push(row);
        row = "";
        if (lines.length >= maxLines) break;
      }
      row += ch;
    }
    if (row && lines.length < maxLines) lines.push(row);
    return lines;
  }

  function paintIdle(s) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, 128, 64);
    const size = 22;
    drawEye(40, 32, size, s.eyeShape, s.pupilStyle, s.pupilSize);
    drawEye(88, 32, size, s.eyeShape, s.pupilStyle, s.pupilSize);

    // Locked chrome — flush to top of screen
    drawCorner(formatUptime(uptimeTick), 1, 2, "left");
    drawCorner(FIRMWARE_LABEL, 127, 2, "right");
    drawCorner(s.cornerBL, 1, 56, "left");
    drawCorner(s.cornerBR, 127, 56, "right");
  }

  function paintSwitch(s) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, 128, 64);
    ctx.fillStyle = "#fff";
    ctx.font = "10px monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const lines = wrapText(s.screenText, 16, 4);
    lines.forEach((line, i) => ctx.fillText(line, 4, 10 + i * 12));
  }

  function syncPreview() {
    const s = readState();
    pupilSizeLabel.textContent = String(s.pupilSize);
    prevBlue.classList.toggle("on", s.ledBlue);
    prevRed.classList.toggle("on", s.ledRed);
    prevYellow.classList.toggle("on", s.ledYellow);
    stageMode.textContent = previewMode === "idle" ? "Idle face" : "Switch on";
    if (previewMode === "switch") paintSwitch(s);
    else paintIdle(s);
    btnFlash.disabled = !port;
  }

  document.querySelectorAll(".mode").forEach((btn) => {
    btn.addEventListener("click", () => {
      previewMode = btn.dataset.mode || "idle";
      document.querySelectorAll(".mode").forEach((b) => b.classList.toggle("on", b === btn));
      syncPreview();
    });
  });

  [
    eyeShape,
    pupilStyle,
    pupilSize,
    cornerBL,
    cornerBR,
    screenText,
    ledBlue,
    ledRed,
    ledYellow,
  ].forEach((el) => {
    el.addEventListener("input", syncPreview);
    el.addEventListener("change", syncPreview);
  });

  btnDefaultEyes.addEventListener("click", setDefaultEyes);

  setInterval(() => {
    uptimeTick += 1;
    if (previewMode === "idle") syncPreview();
  }, 1000);

  function delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function waitForPrefix(prefix, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        lineWaiters = lineWaiters.filter((w) => w !== onLine);
        reject(new Error(`timeout waiting for ${prefix}`));
      }, timeoutMs);
      function onLine(line) {
        if (!line.startsWith(prefix)) return;
        clearTimeout(timer);
        lineWaiters = lineWaiters.filter((w) => w !== onLine);
        resolve(line);
      }
      lineWaiters.push(onLine);
    });
  }

  async function disconnect() {
    readLoopActive = false;
    lineWaiters = [];
    try {
      if (reader) {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    } catch (_) {}
    reader = null;
    try {
      if (writer) {
        await writer.close().catch(() => {});
        writer.releaseLock();
      }
    } catch (_) {}
    writer = null;
    if (port) {
      try {
        await port.close();
      } catch (_) {}
    }
    port = null;
    setConnected(false, "Connect USB");
    syncPreview();
  }

  async function readLoop() {
    if (!port || !port.readable) return;
    readLoopActive = true;
    const decoder = new TextDecoder();
    reader = port.readable.getReader();
    try {
      while (readLoopActive) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        lineBuffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = lineBuffer.search(/\r?\n/)) >= 0) {
          const line = lineBuffer.slice(0, idx).trim();
          lineBuffer = lineBuffer.slice(idx).replace(/^\r?\n/, "");
          if (line) onDeviceLine(line);
        }
      }
    } catch (_) {
      if (readLoopActive) {
        setStatus("USB disconnected — plug Jeremy back in.");
        setConnected(false, "Connect USB");
        port = null;
        syncPreview();
      }
    } finally {
      try {
        reader.releaseLock();
      } catch (_) {}
      reader = null;
    }
  }

  function parsePipe(line) {
    return line.split("|");
  }

  function onDeviceLine(line) {
    for (const w of [...lineWaiters]) w(line);

    if (line.startsWith("JEREMY_OK|")) {
      const ver = line.split("|")[1] || "?";
      setStatus(`Linked · firmware ${ver}`);
    } else if (line.startsWith("OK|")) {
      setStatus(`Saved. Switch text is “${line.slice(3)}”.`);
    } else if (line.startsWith("LOOKOK|")) {
      setStatus("Face look saved on device.");
    } else if (line.startsWith("SWITCH|")) {
      const p = parsePipe(line);
      if (p.length >= 5) {
        applyState({
          screenText: p[1].slice(0, 32),
          ledBlue: p[2] === "1",
          ledRed: p[3] === "1",
          ledYellow: p[4] === "1",
        });
      }
    } else if (line.startsWith("LOOK|")) {
      const p = parsePipe(line);
      // LOOK|shape|pupil|size|tl|tr|bl|br|uptime
      if (p.length >= 9) {
        applyState({
          eyeShape: Number(p[1]) || 0,
          pupilStyle: Number(p[2]) || 0,
          pupilSize: Number(p[3]) || 4,
          cornerBL: p[6] || "",
          cornerBR: p[7] || "",
        });
        setStatus("Loaded look from Jeremy.");
      }
    } else if (line.startsWith("ERR|")) {
      setStatus(`Device error: ${line}`);
    }
  }

  async function writeLine(s) {
    if (!writer) throw new Error("Not connected");
    await writer.write(new TextEncoder().encode(s + "\n"));
  }

  async function pickPort(forcePicker = false) {
    if (!forcePicker) {
      const remembered = await navigator.serial.getPorts();
      if (remembered.length === 1) return remembered[0];
    }
    return await navigator.serial.requestPort();
  }

  async function openPort(p) {
    if (p.readable || p.writable) {
      try {
        await p.close();
      } catch (_) {}
      await delay(200);
    }
    await p.open({ baudRate: 115200, bufferSize: 256 });
  }

  function friendlyOpenError(err) {
    const msg = err && err.message ? err.message : String(err);
    if (/Failed to open serial port|NetworkError|InvalidStateError/i.test(msg)) {
      return "COM port busy — close Arduino Serial Monitor, unplug/replug USB, then Connect again.";
    }
    if (/No port selected|NotFoundError/i.test(msg)) {
      return "No port picked — plug Jeremy in, then try Connect again.";
    }
    return msg;
  }

  async function handshake(timeoutMs = 18000) {
    const deadline = Date.now() + timeoutMs;
    let attempt = 0;
    while (Date.now() < deadline) {
      attempt += 1;
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setStatus(`Waiting for boot after USB reset… ${left}s (${attempt})`);
      await writeLine("HELLO");
      try {
        return await waitForPrefix("JEREMY_OK|", 350);
      } catch (_) {}
    }
    throw new Error("No reply. Flash BOT_CODE 2.6.50+, close Serial Monitor, try again.");
  }

  async function connect() {
    if (!hasSerial) {
      setStatus("Web Serial needs Chrome or Edge on a computer.");
      return;
    }
    btnConnect.disabled = true;
    try {
      if (port) await disconnect();
      setStatus("Pick Jeremy’s USB port…");
      port = await pickPort(false);
      try {
        await openPort(port);
      } catch (_) {
        setStatus("Port busy — pick COM again (close Serial Monitor first)…");
        try {
          await port.close();
        } catch (_) {}
        port = await pickPort(true);
        await openPort(port);
      }
      try {
        await port.setSignals({ dataTerminalReady: false, requestToSend: false });
      } catch (_) {}

      writer = port.writable.getWriter();
      lineBuffer = "";
      readLoop();

      const hello = await handshake(18000);
      const ver = hello.split("|")[1] || "?";
      setConnected(true, "Connected");
      setStatus(`Linked · firmware ${ver}`);

      await writeLine("GETLOOK");
      try {
        await waitForPrefix("LOOK|", 2000);
      } catch (_) {}
      await writeLine("GETSWITCH");
      try {
        await waitForPrefix("SWITCH|", 2000);
      } catch (_) {}
    } catch (err) {
      await disconnect();
      setStatus(friendlyOpenError(err));
    } finally {
      btnConnect.disabled = false;
      syncPreview();
    }
  }

  async function flash() {
    btnFlash.disabled = true;
    try {
      if (!port || !writer) {
        await connect();
        if (!port) return;
      }
      const s = readState();
      setStatus("Downloading look…");
      await writeLine("HELLO");
      try {
        await waitForPrefix("JEREMY_OK|", 800);
      } catch (_) {
        await handshake(8000);
      }

      const lookCmd = [
        "SETLOOK",
        s.eyeShape,
        s.pupilStyle,
        s.pupilSize,
        s.cornerTL,
        s.cornerTR,
        s.cornerBL,
        s.cornerBR,
        s.showUptime ? 1 : 0,
      ].join("|");
      await writeLine(lookCmd);
      await waitForPrefix("LOOKOK|", 3000);

      const swCmd = `SETSW|${s.ledBlue ? 1 : 0}|${s.ledRed ? 1 : 0}|${s.ledYellow ? 1 : 0}|${s.screenText}`;
      setStatus("Downloading switch program…");
      await writeLine(swCmd);
      await waitForPrefix("OK|", 3000);
      setStatus("Downloaded. Idle face + switch program are on Jeremy.");
    } catch (err) {
      setStatus(`Download failed: ${err.message || err}`);
      await disconnect();
    } finally {
      btnFlash.disabled = !port;
    }
  }

  if (hasSerial && navigator.serial.addEventListener) {
    navigator.serial.addEventListener("connect", () => {
      setStatus("USB device attached — click Connect USB.");
    });
    navigator.serial.addEventListener("disconnect", async () => {
      if (port) {
        await disconnect();
        setStatus("Jeremy unplugged.");
      }
    });
  }

  btnConnect.addEventListener("click", connect);
  btnFlash.addEventListener("click", flash);

  if (!hasSerial) {
    setStatus("Web Serial missing — use Chrome or Edge on desktop.");
    btnConnect.disabled = true;
  }

  syncPreview();
})();
