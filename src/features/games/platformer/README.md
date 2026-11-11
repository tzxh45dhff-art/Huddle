# Super Huddle

The Play picker now opens Super Huddle instead of Trap Dash. This is an original
cooperative pixel platformer inspired by classic side-scrollers. It is not a
complete recreation of a Nintendo game: its sprites, font, three courses and
three synthesized scores are original. Pipes are obstacles, power blocks give
temporary invincibility, and the castle is a finish landmark; there are no warp
rooms or boss fights in this version.

1–8 room members can play. Choose a character, ready up, use A/D or arrows to
move, and hold Space/Z to jump higher. Touch controls support simultaneous
movement and jump. Run is enabled by default. Coins, blocks and enemies are
shared; individual scores are recorded. Reaching a checkpoint saves a respawn
position. The first finisher gives friends another twenty seconds. All three
worlds clear to win; a timed-out course repeats with scores retained.

The server runs 60 Hz fixed-step collisions and publishes at 20 Hz. Clients
predict movement but cannot award coins, hits or finishes. Input sequences and
world epochs reject stale controls. Held movement expires after connection loss.
Joining mid-course uses the first unfinished player's checkpoint. There is a
20-minute session limit. Muting, hidden-tab suspension, reduced-motion effects,
keyboard focus and pointer cancellation are supported.

## Verification

- Rules: readiness, invalid/stale input, variable jump height, input expiry,
  single block awards, prediction isolation, stomps/damage/immunity, fall recovery,
  checkpoint support, enemy patrol support, transitions and all three courses
  traversed using normal inputs.
- Real sockets: two authenticated synthetic room members share character choices,
  coins and movement, reconnect to the same state and end the session.
- Audio: gesture-only creation, a single context through scene changes, distinct
  layered effects, mute, suspend/resume and cleanup. No recorded-device listening
  or eight-device load test has been performed.
- Browser: desktop 1440×900 and phone 375×812, initial/ready/play views, keyboard
  and touch movement, shared coins, reconnect and sound controls. The isolated
  preview uses the real component and rules; the network preview uses a disposable
  scratch API and synthetic accounts.

## Local preview

From the repository root:

```sh
npm run dev -- --host 127.0.0.1 --port 5182
```

Open `/scripts/platformer-preview/index.html`. To use two browser clients:

```sh
CLIENT_ORIGIN=http://127.0.0.1:5182 server/node_modules/.bin/tsx scripts/platformer-preview/live.ts
```

Then open the preview with `?network=alex` and `?network=sam`. This helper serves
in-memory synthetic credentials only to the exact local preview origin, never
writes them to disk and never touches the normal development database. Stop the
helper with Ctrl+C after testing. The standalone preview is a development entry,
not part of the production bundle.

## Shipping

Both client and server must ship together. No packages or environment settings
were added. After this branch is explicitly approved and pushed to main, run in
the Acer checkout:

```sh
git pull --ff-only origin main
```

Restart the existing server process using its normal launcher:

```sh
bash server/start-server.sh
```

Do not launch a duplicate process. The existing start script installs/builds as
needed. This work does not alter the parked board-games branch.
