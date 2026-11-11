# Trap Dash

Play → Trap Dash. One to eight room members; practice racers fill up to three seats. Everyone places a hidden trap for ten seconds, sees a three-second countdown, then races for up to 22 seconds. Five rounds, with a short local replay between rounds. Players who arrive after the start watch until the next match.

Move with arrows / A D; jump with Space / W / Up. Touch controls support simultaneous movement and jump. A jump requires a fresh press. Finish awards 10 points to first, then one fewer per position (minimum three); catching each other racer awards two points once per round. Springs and ice can help or hinder anyone. A missed placement is filled automatically. Colliding placements move to the nearest free slot to the right, wrapping around.

The server simulates fixed 60 Hz physics and publishes at 20 Hz. Clients render interpolated positions in a canvas at display refresh rate. Inputs expire after 900 ms; blur, hiding the tab and unmount release controls. Server time controls all phases, scoring and results. Private placements are removed in the per-viewer projection. Reconnection restores the current race. Results use the existing party-game persistence.

No new packages, paid services, migrations or environment settings. After a future push, the Acer needs to pull and restart its existing `server/start-server.sh` process because this adds server game rules.

After the change is pushed, stop the existing Acer server with Ctrl+C, then from the repository root run:

```sh
git pull --ff-only origin main
```

```sh
./server/start-server.sh
```

Success means the API and tunnel start, and Trap Dash can start from Play. No package changes are required.

## Local visual preview

Run `npm run dev -- --port 5182 --strictPort`, then open `/scripts/trapdash-preview/index.html`. This mounts the real UI and game rules with an in-memory clock and synthetic opponents. It does not connect to an API or a database. Room transport is covered separately by the real two-client socket test.

## Verification

`server/test/trapdash.test.ts` covers private placement, collisions, phase deadlines, authorization, stale input, jumping, respawn, trap scoring, server-owned finish points, automatic completion, real room synchronization and reconnecting. The standard frontend/server type checks, lint, production build and full server suite also apply. Browser checks cover desktop and portrait phone layouts, placement, keyboard movement and jumping, touch controls, round transitions and replay. Cross-network latency and a physical phone still need playtesting.
