import Redis from "ioredis";

const c = new Redis("rediss://default:gQAAAAAAAVV7AAIncDI2ZTc3OTc2N2U0OGY0NzMzOTg4YjFmNDViZWEyZjY2M3AyODc0MTk@assured-tadpole-87419.upstash.io:6379");
await c.call("DEL", "scan_queue");
await c.quit();
console.log("Queue cleared");