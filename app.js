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
  /** @type {Array<(line: string) => void>} */
  let lineWaiters = [];

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
    if (e.dataTransfer.getData("text/plain") === "when-switch") placeProgram();
  });

  [screenText, ledBlue, ledRed, ledYellow].forEach((el) => {
    el.addEventListener("input", syncPreview);
    el.addEventListener("change", syncPreview);
  });

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
    // Wake anyone waiting on a prefix first
    for (const w of [...lineWaiters]) w(line);

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
    await writer.write(new TextEncoder().encode(s + "\n"));
  }

  async function pickPort() {
    const remembered = await navigator.serial.getPorts();
    if (remembered.length === 1) return remembered[0];
    // No vendor filter — ESP32 boards use many USB chips; filters made picking feel “stuck”
    try {
      return await navigator.serial.requestPort();
    } catch (err) {
      throw err;
    }
  }

  /** Keep pinging until Jeremy answers (USB open reboots the ESP; boot can take ~8–15s). */
  async function handshake(timeoutMs = 18000) {
    const deadline = Date.now() + timeoutMs;
    let attempt = 0;
    while (Date.now() < deadline) {
      attempt += 1;
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setStatus(`Waiting for Jeremy after USB reset… ${left}s (${attempt})`);
      await writeLine("HELLO");
      try {
        const line = await waitForPrefix("JEREMY_OK|", 350);
        return line;
      } catch (_) {
        // retry — board may still be in boot animation / WiFi bring-up
      }
    }
    throw new Error(
      "No reply from Jeremy. Flash BOT_CODE 2.6.42+ and keep USB plugged in, then try again."
    );
  }

  async function connect() {
    if (!hasSerial) {
      setStatus("This browser can’t use USB serial. Open in Chrome or Edge on desktop.");
      return;
    }
    btnConnect.disabled = true;
    try {
      if (port) await disconnect();

      setStatus("Pick Jeremy’s USB port…");
      port = await pickPort();

      await port.open({ baudRate: 115200, bufferSize: 256 });
      // Avoid holding DTR/RTS high (can keep some boards in reset / slow reconnect)
      try {
        await port.setSignals({ dataTerminalReady: false, requestToSend: false });
      } catch (_) {}

      writer = port.writable.getWriter();
      readLoop();

      setStatus("USB open resets Jeremy — waiting for boot…");
      const hello = await handshake(18000);
      const ver = hello.split("|")[1] || "?";
      setConnected(true, "Jeremy linked");
      setStatus(`Linked to Jeremy ${ver}. Ready to download.`);

      await writeLine("GETSWITCH");
      try {
        await waitForPrefix("SWITCH|", 2000);
      } catch (_) {
        // fine — keep local editor values
      }
    } catch (err) {
      await disconnect();
      const msg = err && err.message ? err.message : String(err);
      if (/No port selected/i.test(msg)) {
        setStatus("No port picked — plug Jeremy in, then try Find again.");
      } else {
        setStatus(msg);
      }
    } finally {
      btnConnect.disabled = false;
    }
  }

  async function flash() {
    if (!programOnBoard) {
      setStatus("Add the “when switch flicked” block first.");
      return;
    }
    btnFlash.disabled = true;
    try {
      if (!port || !writer) {
        await connect();
        if (!port) return;
      }

      const text =
        (screenText.value || "JEREMY CO")
          .replace(/\|/g, " ")
          .replace(/[\r\n]+/g, " ")
          .trim()
          .slice(0, 32) || "JEREMY CO";
      const b = ledBlue.checked ? 1 : 0;
      const r = ledRed.checked ? 1 : 0;
      const y = ledYellow.checked ? 1 : 0;
      const cmd = `SETSW|${b}|${r}|${y}|${text}`;

      setStatus("Downloading…");
      // Quick re-hello in case link went stale
      await writeLine("HELLO");
      try {
        await waitForPrefix("JEREMY_OK|", 800);
      } catch (_) {
        setStatus("Reconnecting…");
        await handshake(8000);
      }

      await writeLine(cmd);
      await waitForPrefix("OK|", 3000);
    } catch (err) {
      setStatus(`Download failed: ${err.message || err}`);
      await disconnect();
    } finally {
      btnFlash.disabled = !port || !programOnBoard;
    }
  }

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
    navigator.serial.getPorts().then((ports) => {
      if (ports.length === 1) {
        setStatus("Jeremy USB remembered — click Find (links in a few seconds after USB reset).");
      }
    });
  }

  placeProgram();
})();
