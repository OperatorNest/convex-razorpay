export async function stopChild(child) {
  if (!child?.pid) return;
  const exited =
    typeof child.exitCode === "number" || typeof child.signalCode === "string"
      ? Promise.resolve()
      : new Promise((resolve) => child.once("exit", resolve));
  const killGroup = (signal) => {
    try {
      process.kill(-child.pid, signal);
    } catch {
      // The owned process group already exited.
    }
  };
  killGroup("SIGTERM");
  let timer;
  const grace = new Promise((resolve) => {
    timer = setTimeout(() => resolve(false), 10_000);
  });
  const graceful = await Promise.race([exited.then(() => true), grace]);
  clearTimeout(timer);
  if (!graceful) {
    killGroup("SIGKILL");
    await exited;
  }
}
