/**
 * Live updates for the help chat, over server-sent events: each signed-in
 * person listens for their own conversations, the admin console for all of
 * them. Kept in this process - one instance serves it; more than one would
 * need a shared channel between them.
 */
import type { Request, Response } from "express";

type Send = (event: object) => void;

const people = new Map<string, Set<Send>>();
const team = new Set<Send>();

/**
 * Who on the team is looking, by the console checking in: an open connection
 * alone isn't proof - a proxy can hold one open after the tab has gone.
 */
const HERE_FOR_MS = 60_000;
const here = new Map<string, number>();
const teamHere = () => [...here.values()].some((t) => Date.now() - t < HERE_FOR_MS);
let saidHere = false;

function tellAll(set: Iterable<Send>, event: object) {
  for (const send of set) {
    try {
      send(event);
    } catch {
      /* a closed connection drops out on its own */
    }
  }
}

/** Forgets whoever stopped checking in. */
function prune() {
  for (const [k, t] of here) if (Date.now() - t >= HERE_FOR_MS) here.delete(k);
}

/** Everyone listening, told when the team comes or goes. */
function presence() {
  prune();
  const now = teamHere();
  if (now === saidHere) return;
  saidHere = now;
  const event = { type: "presence", teamOnline: now };
  for (const set of people.values()) tellAll(set, event);
}
// Someone who stopped checking in has gone.
setInterval(presence, 10_000).unref();

export const live = {
  toPerson: (userId: string, event: object) => tellAll(people.get(userId) ?? [], event),
  toTeam: (event: object) => tellAll(team, event),
  teamOnline: teamHere,
  /** The console says someone is looking at the inbox - or has left it. */
  here: (who: string) => {
    // Anyone who'd gone is gone first - so coming back is always news.
    presence();
    here.set(who, Date.now());
    presence();
  },
  away: (who: string) => {
    here.delete(who);
    presence();
  },
  personOnline: (userId: string) => (people.get(userId)?.size ?? 0) > 0,
};

/** Holds the response open as an event stream until the other end goes. */
function stream(req: Request, res: Response, hello: object, join: (send: Send) => () => void) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();
  const send: Send = (e) => void res.write(`data: ${JSON.stringify(e)}\n\n`);
  send(hello);
  const leave = join(send);
  // A comment every so often keeps proxies from closing a quiet connection.
  const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
  req.on("close", () => {
    clearInterval(ping);
    leave();
  });
}

export function listenAsPerson(req: Request, res: Response, userId: string) {
  stream(req, res, { type: "presence", teamOnline: teamHere() }, (send) => {
    const set = people.get(userId) ?? new Set<Send>();
    set.add(send);
    people.set(userId, set);
    return () => {
      set.delete(send);
      if (set.size === 0) people.delete(userId);
    };
  });
}

export function listenAsTeam(req: Request, res: Response) {
  stream(req, res, { type: "hello" }, (send) => {
    team.add(send);
    return () => void team.delete(send);
  });
}
