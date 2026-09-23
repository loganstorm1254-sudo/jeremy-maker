(() => {
  const $ = (id) => document.getElementById(id);

  const board = $("board");
  const boardEmpty = $("boardEmpty");
  const stack = $("stack");
  const statusLine = $("statusLine");
  const connDot = $("connDot");
  const connLabel = $("connLabel");
  const btnConnect = $("btnConnect");
  const btnFlash = $("btnFlash");
  const screenText = $("screenText");
  const ledBlue = $("ledBlue");
  const ledRed = $("ledRed");
  const ledYellow = $("ledYellow");
  const oledText = $("oledText");
  const prevBlue = $("prevBlue");
  const prevRed = $("prevRed");
  const prevYellow = $("prevYellow");

  /** @type {SerialPort | null} */
  let port = null;
  /** @type {ReadableStreamDefaultReader | null} */
  let reader = null;
  /** @type {WritableStreamDefaultWriter | null} */
  let writer = null;
  let readLoopActive = false;
  let programOnBoard = false;
  let lineBuffer = "";

  const hasSerial = "serial" in navigator;

  function setStatus(msg) {
    statusLine.textContent = msg;
  }

  function setConnected(on, label) {
    connDot.classList.toggle("on", on);
    connLabel.textContent = label;
    btnFlash.disabled = !on || !programOnBoard;
  }

  function syncPreview() {
    const text = (screenText.value || "JEREMY CO").slice(0, 32);
    oledText.textContent = text;
    prevBlue.classList.toggle("on", ledBlue.checked);
    prevRed.classList.toggle("on", ledRed.checked);
    prevYellow.classList.toggle("on", ledYellow.checked);
    btnFlash.disabled = !port || !programOnBoard;
  }

  function placeProgram() {
    programOnBoard = true;
    boardEmpty.classList.add("hidden");
    stack.classList.remove("hidden");
    syncPreview();
    setStatus("Program ready — plug Jeremy in and download when you’re set.");
  }

  // Toolbox: click or drag
  document.querySelectorAll("[data-add='when-switch']").forEach((el) => {
    el.addEventListener("click", placeProgram);
    el.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", "when-switch");
      e.dataTransfer.effectAllowed = "copy";
    });
  });

  board.addEventListener("dragover", (e) => {
    e.preventDefault();
    board.classList.add("drag-over");
  });
  board.addEventListener("dragleave", () => board.classList.remove("drag-over"));
  board.addEventListener("drop", (e) => {
    e.preventDefault();
    board.classList.remove("drag-over");
    const kind = e.dataTransfer.getData("text/plain");
    if (kind === "when-switch") placeProgram();
  });

  [screenText, ledBlue, ledRed, ledYellow].forEach((el) => {
    el.addEventListener("input", syncPreview);
    el.addEventListener("change", syncPreview);
  });

  async function disconnect() {
    readLoopActive = false;
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
    setConnected(false, "Find plugged-in Jeremy");
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
    } catch (err) {
      if (readLoopActive) {
        setStatus("USB disconnected — plug Jeremy back in.");
        setConnected(false, "Find plugged-in Jeremy");
        port = null;
      }
    } finally {
      try {
        reader.releaseLock();
      } catch (_) {}
      reader = null;
    }
  }

  function onDeviceLine(line) {
    if (line.startsWith("JEREMY_OK|")) {
      const ver = line.split("|")[1] || "?";
      setStatus(`Linked to Jeremy ${ver}. Ready to download.`);
    } else if (line.startsWith("OK|")) {
      setStatus(`Downloaded. Switch text is now “${line.slice(3)}”. Flick the switch to try it.`);
    } else if (line.startsWith("SWITCH|")) {
      const parts = line.split("|");
      if (parts.length >= 5) {
        screenText.value = parts[1].slice(0, 32);
        ledBlue.checked = parts[2] === "1";
        ledRed.checked = parts[3] === "1";
        ledYellow.checked = parts[4] === "1";
        if (!programOnBoard) placeProgram();
        else syncPreview();
        setStatus("Loaded current program from Jeremy.");
      }
    } else if (line.startsWith("ERR|")) {
      setStatus(`Device error: ${line}`);
    }
  }

  async function writeLine(s) {
    if (!writer) throw new Error("Not connected");
    const encoder = new TextEncoder();
    await writer.write(encoder.encode(s + "\n"));
  }

  async function connect() {
    if (!hasSerial) {
      setStatus("This browser can’t use USB serial. Open in Chrome or Edge on desktop.");
      return;
    }
    try {
      if (port) await disconnect();

      // Prefer already-authorized ports (plugged in previously)
      const ports = await navigator.serial.getPorts();
      if (ports.length === 1) {
        port = ports[0];
      } else {
        port = await navigator.serial.requestPort({
          filters: [
            { usbVendorId: 0x10c4 }, // CP210x
            { usbVendorId: 0x1a86 }, // CH340
            { usbVendorId: 0x0403 }, // FTDI
            { usbVendorId: 0x303a }, // Espressif
          ],
        });
      }

      await port.open({ baudRate: 115200 });
      writer = port.writable.getWriter();
      setConnected(true, "Jeremy linked");
      setStatus("Talking to Jeremy…");
      readLoop();
      await delay(200);
      await writeLine("HELLO");
      await delay(150);
      await writeLine("GETSWITCH");
    } catch (err) {
      await disconnect();
      const msg = err && err.message ? err.message : String(err);
      if (/No port selected/i.test(msg)) {
        setStatus("No port picked — plug Jeremy in, then try Find again.");
      } else {
        setStatus(`Couldn’t open USB: ${msg}`);
      }
    }
  }

  function delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function flash() {
    if (!port || !writer) {
      await connect();
      if (!port) return;
    }
    if (!programOnBoard) {
      setStatus("Add the “when switch flicked” block first.");
      return;
    }
    const text = (screenText.value || "JEREMY CO")
      .replace(/\|/g, " ")
      .replace(/[\r\n]+/g, " ")
      .trim()
      .slice(0, 32) || "JEREMY CO";
    const b = ledBlue.checked ? 1 : 0;
    const r = ledRed.checked ? 1 : 0;
    const y = ledYellow.checked ? 1 : 0;
    const cmd = `SETSW|${b}|${r}|${y}|${text}`;
    btnFlash.disabled = true;
    setStatus("Downloading program over USB…");
    try {
      await writeLine(cmd);
    } catch (err) {
      setStatus(`Download failed: ${err.message || err}`);
      await disconnect();
    } finally {
      btnFlash.disabled = !port || !programOnBoard;
    }
  }

  // Hot-plug: when a serial device appears, nudge the user
  if (hasSerial && navigator.serial.addEventListener) {
    navigator.serial.addEventListener("connect", () => {
      setStatus("USB device plugged in — click Find plugged-in Jeremy.");
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
    setStatus("Web Serial missing — use Chrome or Edge on a computer with USB.");
    btnConnect.disabled = true;
  } else {
    // Auto-try previously permitted port if exactly one is remembered
    navigator.serial.getPorts().then((ports) => {
      if (ports.length === 1) {
        setStatus("Jeremy USB remembered — click Find to reconnect, or Download.");
      }
    });
  }

  // Start with the block already placed (faster than MakeCode empty for one feature)
  placeProgram();
})();
