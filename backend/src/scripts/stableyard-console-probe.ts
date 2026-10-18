import "dotenv/config";
import { env } from "../config/env";

/**
 * Is there a console endpoint that configures routing? Read-only.
 *
 * The docs describe a Partner Console API but document exactly one route on it
 * - webhooks - while our credential carries a v2:console scope. If routing can
 * be turned on by us at all, it would be under there.
 *
 * Every request is a GET. Nothing here creates, enables or changes anything;
 * it only asks which paths exist.
 */

const PATHS = (appId: string, envId: string) => [
  `/v2/console/apps/${appId}`,
  `/v2/console/apps/${appId}/environments`,
  `/v2/console/apps/${appId}/environments/${envId}`,
  `/v2/console/apps/${appId}/environments/${envId}/products`,
  `/v2/console/apps/${appId}/environments/${envId}/capabilities`,
  `/v2/console/apps/${appId}/environments/${envId}/networks`,
  `/v2/console/apps/${appId}/environments/${envId}/config`,
  `/v2/console/apps/${appId}/environments/${envId}/webhooks`,
];

(async () => {
  const base = env.STABLEYARD_BASE_URL.replace(/\/$/, "");
  const auth =
    "Basic " +
    Buffer.from(`${env.STABLEYARD_APP_ID}:${env.STABLEYARD_APP_SECRET}`).toString("base64");

  const cfgRes = await fetch(`${base}/v2/partners/config`, {
    headers: { Authorization: auth, "Content-Type": "application/json" },
  });
  const cfg: any = await cfgRes.json();
  const c = cfg?.data ?? cfg;
  const appId = c.appId;
  const envId = c.environmentId;

  console.log(`app ${appId}  env ${envId}\n`);

  for (const path of PATHS(appId, envId)) {
    try {
      const res = await fetch(`${base}${path}`, {
        headers: { Authorization: auth, "Content-Type": "application/json" },
      });
      const text = await res.text();
      console.log(`${String(res.status).padEnd(4)} ${path}`);
      if (res.ok) {
        const keys = (() => {
          try {
            const j = JSON.parse(text);
            const d = j?.data ?? j;
            return Array.isArray(d) ? `array(${d.length})` : Object.keys(d).join(", ");
          } catch {
            return text.slice(0, 120);
          }
        })();
        console.log(`       keys: ${keys}`);
      }
    } catch (e: any) {
      console.log(`ERR  ${path}  ${e?.message}`);
    }
  }
})();
