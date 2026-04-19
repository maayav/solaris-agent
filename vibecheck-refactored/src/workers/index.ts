import { ScanWorker } from "./scan-worker";

const worker = new ScanWorker();

async function main() {
  console.log("VibeCheck Scan Worker starting...");

  const shutdown = async () => {
    console.log("Shutting down...");
    await worker.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  try {
    await worker.start();
  } catch (error) {
    console.error("Worker crashed:", error);
    await shutdown();
  }
}

main();
