import { Hono } from "hono";
import { projectsRoute } from "./projects";
import { scansRoute } from "./scans";
import { vulnerabilitiesRoute } from "./vulnerabilities";
import { healthRoute } from "./health";
import { reportsRoute } from "./reports";
import { swarmRoute } from "./swarm";
import { chatRoute } from "./chat";

const v0 = new Hono();

v0.route("/projects", projectsRoute);
v0.route("/scans", scansRoute);
v0.route("/vulnerabilities", vulnerabilitiesRoute);
v0.route("/health", healthRoute);
v0.route("/reports", reportsRoute);
v0.route("/swarm", swarmRoute);
v0.route("/chat", chatRoute);

export { v0 };
