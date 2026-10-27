const [webSocketUrl, extensionPath] = process.argv.slice(2);

if (!webSocketUrl || !extensionPath) {
  console.error("Usage: node load-extension.mjs <browser-websocket-url> <extension-path>");
  process.exit(2);
}

const socket = new WebSocket(webSocketUrl);
const timeout = setTimeout(() => {
  console.error("Timed out while loading the extension.");
  socket.close();
  process.exit(1);
}, 10_000);

socket.addEventListener("open", () => {
  socket.send(
    JSON.stringify({
      id: 1,
      method: "Extensions.loadUnpacked",
      params: { path: extensionPath }
    })
  );
});

socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  if (message.id !== 1) return;
  clearTimeout(timeout);
  if (message.error) {
    console.error(JSON.stringify(message.error));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify(message.result));
  }
  socket.close();
});

socket.addEventListener("error", () => {
  clearTimeout(timeout);
  console.error("Unable to connect to the Chrome DevTools browser endpoint.");
  process.exitCode = 1;
});
