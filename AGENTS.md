# AGENTS.md

## Project summary and core loop
Pick up at a restaurant, then drive across the city to the customer. Each delivery pays Turkish lira plus a speed bonus, and a new mission starts right away. If time runs out, you lose ₺20.

## How to play / controls
Drive your scooter to the restaurant marked in yellow to pick up the order automatically. Then follow the green arrow and beam of light to the customer and deliver before the timer runs out.
Controls: PC: W/↑ gas, S/↓ brake/reverse, A/D or ←/→ steer. Mobile: ◀ ▶ buttons on the lower left, FREN and GAZ on the lower right. The speaker button at the top mutes the sound.

## Important files
- `/index.html` — entry point: importmap, canvas/DOM shell, script bootstrap
- `/rosebud-game-defaults.css` — project file
- `/rosebud-game-defaults.js` — game module
- `/rosie/README.md` — Rosie pre-built helper module
- `/rosie/roseblox.js` — Rosie pre-built helper module
- `/art_direction.md` — visual direction used for generated art
- `/sound_direction.md` — audio direction used for generated sound
- `/main.js` — game bootstrap and main loop

## Assets and audio
Models: `assets/models/scooter.glb`
Audio: `assets/audio/cash-chime.mp3`, `assets/audio/city-music.mp3`
Sound direction: - Upbeat, light Turkish-pop-style loop, medium energy - SFX: order pickup/delivery cash chime
Playback note: reference media as `assets/...`; browsers start audio only after the first user gesture.

## Notes for future edits
Everything lives in main.js. The city is a 6x6 grid (BLOCK 26, ROAD 10, CELL 36), centred on the origin. Collision is circle-vs-AABB against the `colliders` array. Restaurants and customers are stored in the `restaurants`/`customers` arrays. The scooter uses custom arcade physics (`state`) and does not use roseblox. The model scooter.glb is fitted to 2 m.

## Final validation status
Static: 0 blocking, 20 advisory; overall clean. Runtime behavior was not checked during generation.
Finished via the `finish` tool.
