# Super Huddle

The Play picker now opens Super Huddle instead of Trap Dash. This is an original
competitive pixel platform racer inspired by classic side-scrollers. It is not a
complete recreation of a Nintendo game: its sprites, font, three courses and
three synthesized scores are original. Pipes are obstacles, question blocks give
random power-ups, and the castle is a finish landmark; there are no warp
rooms or boss fights in this version.

1–8 room members race across three courses. Choose a character, ready up, use
A/D or arrows to move, and hold Space/Z to jump higher. Touch controls support
simultaneous movement and jump. Run is enabled by default. Everyone starts at
the same x position; characters do not block each other.

Bump any unused question block from underneath to receive a server-rolled bonus:

- Star Guard: seven seconds of immunity to creatures and hazards; breaks bricks.
- Turbo Boots: nine seconds of faster movement and longer running jumps.
- Spring Boots: ten seconds of higher jumps to reach upper routes.
- Coin Magnet: ten seconds of collecting coins within a 105-pixel radius.

One power is active at a time. A new pickup replaces it; falling cancels it.
Each block is claimed once globally. A rising icon, a coloured character effect,
a distinct pickup sound and a timed HUD explain the reward. Spikes, faster enemies,
moving saws, wider gaps and upper routes make the later courses harder. The base
route remains beatable without a bonus.

Finishing awards 10 / 7 / 5 / 3 / 2 / 1 / 1 / 1 championship points. Simultaneous
finishes share a place; subsequent places skip appropriately. The first finish
starts a 15-second final sprint. DNF gets no finish points. Every course runs once,
including a timeout. Total race points determine the winner; coins break ties;
identical totals share the win. Arcade score is tracked separately and cannot
outweigh race points. Course limits are 110 / 100 / 95 seconds.

The server runs 60 Hz fixed-step collisions and publishes at 20 Hz. Clients
predict movement but cannot roll bonuses or award coins, hits or finishes. Input
sequences and world epochs reject stale controls. Contested pickup processing
rotates between players. Held movement expires after connection loss. Late
entrants join at the starting line. There is a 20-minute session limit. Muting,
hidden-tab suspension, reduced-motion effects, keyboard focus and pointer
cancellation are supported.

## Verification

- Rules: readiness, invalid/stale input, variable jump height, input expiry,
  single block awards, prediction isolation, stomps/damage/immunity, fall recovery,
  checkpoint support, enemy patrol support, transitions and all three courses
  traversed using normal inputs without power-ups; bonus expiry/replacement,
  damage protection, magnet range, speed/jump changes, tied finishes, single-award
  scoring, late-entry fairness, and finite no-retry championships.
- Real sockets: two authenticated synthetic room members share character choices,
  coins, the exact rolled bonus and its expiry, and movement; reconnect to the same state and end the session.
- Audio: gesture-only creation, a single context through scene changes, distinct
  layered effects, mute, suspend/resume and cleanup. No recorded-device listening
  or eight-device load test has been performed.
- Browser: desktop 1440×900 and phone 375×812, initial/ready/play views, keyboard
  and touch movement, shared coins, reconnect and sound controls. The isolated
  preview uses the real component and rules; the network preview uses a disposable
  scratch API and synthetic accounts. Eight-player standings with long names are
  checked using explicit static preview fixtures, including phone scrolling.

## Local preview

From the repository root:

```sh
npm run dev -- --host 127.0.0.1 --port 5182
```

Open `/scripts/platformer-preview/index.html`. Static UI stress fixtures are
`?scene=results`, `?scene=final` and `?scene=power`; these do not simulate a match.
To use two browser clients:

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
