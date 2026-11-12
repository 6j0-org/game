# Game

A small voxel sandbox game in the browser, built with Three.js. No build step and no install.

## Vision

The long-term goal is a **decentralized network of independent servers, all connected to each other**: an interconnected network of worlds. Anyone can run a world, and players can move between them.

What you do there is up to you: build, play minigames, fight other players (PvP), or take it easy with gardening, fishing and the like. It's for socializing with friends or adventuring on your own.

It's a world we can control in an otherwise chaotic reality: a [third place](https://en.wikipedia.org/wiki/Third_place), the social space that isn't home (the first place) or work (the second), where people come back to hang out. The game may be renamed **Third Place** to match.

Eventually, it should reach outside the screen too, with **augmented reality** features.

## Multiplayer

Run the server and share the address with friends on your network:

```sh
node server/index.js          # Node 20+, no npm install needed
# prints http://localhost:8000 and your network address, e.g. http://192.168.1.20:8000
```

Or with Docker:

```sh
docker build -t game .
docker run -d --name game -p 8000:8000 -v game-data:/data game
```

Everyone shares one world: blocks, time of day, monsters, animals, dropped items and coins. You can hit each other (PvP), and the couch pillow and hackysack finally have their intended targets. The server saves the world and each player's inventory, coins and skills to `data/` (or the `/data` volume) every 10 seconds and when it stops.

**Players.** The first time you open a world, you see **Create Player**: pick a name and the world gives your browser a secret key (it keeps only a hash of it). From then on your browser signs you in by itself. Players are stored with the world (the server's `data/world.json`, or your browser's world save in single player). Lost your Player (new browser, cleared site data)? **Recover Player** tells you to ask the server's **Admin**, who can give you a recovery code to type in there. Codes never expire but work once, so store yours in a safe place. The **first Player created on a world is its Admin**: Admins get a **Players** tab in Settings that lists everyone (online or not, level, last seen) and can make recovery codes, rename, kick, ban, delete Players and make other Players Admins. Names are unique.

**Multiplayer differences:**
- The world never pauses. Menus (Q/E, the 3D Printer) don't stop time, so pick your moment.
- **Voice chat is always on.** Everyone who joins is in one server-wide voice channel straight away (your browser asks for the microphone when you connect). Press **V** for voice settings (the Voice tab of Settings): mute your microphone, set the overall volume, and for **each player** a volume (0-200%) and a **Nearby only** box. A nearby-only player is at full volume close up, fades as they get further away, and can't be heard at all past a set distance (the **Voice: full volume within** and **Voice: silent beyond** server settings, 4 and 32 blocks by default). A light next to each name shows who's talking (grey: too far away to hear), and an icon floats over their head while they do. Your choices are remembered in your browser. **Shrunk players sound higher and enlarged players lower** (up to an octave either way). The menu frees your mouse but the world keeps going.
- **Nearby-only players are in the world with you:** their voice comes from where they're standing (turn your head and it moves), walls and doors between you muffle it, and it echoes like the place you're in. Everyone else sounds like a phone call: clear, from nowhere, and walls don't matter. **Hold Z to whisper** (you carry a quarter as far) or **X to shout** (two and a half times as far); the icon over your head shows 🤫 or 📢, and both reaches are server settings.
- **Text chat:** press **T**, type, and Enter: everyone sees it in their message log (bottom right). **/msg Name text** (or /tell, /w) sends a private message. Lines starting with / are console commands.
- **Tab** opens a map of the land around you with everyone's phone on it.
- **T** (skip time) only works in single player.
- Monsters chase, and pets follow, whoever is nearest.

**Voice and HTTPS:** voices go straight from browser to browser on your network (the server keeps track of who's in voice and passes along the set-up). Every pair of players has its own connection, so the more people are online, the more upload bandwidth each one uses. Browsers only let a page use the microphone on `https://` or `http://localhost`, so over a plain `http://192.168…` address friends can hear everyone but not talk. To fix that, give the server a certificate:

```sh
openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 825 \
  -subj "/CN=game" -addext "subjectAltName=IP:192.168.8.135,DNS:localhost"   # use your own IP
TLS_CERT=cert.pem TLS_KEY=key.pem node server/index.js
```

Players open `https://…:8000` and accept the browser's warning about the self-signed certificate once. (With Docker, mount the files and set the same two variables.)

**LibreWolf / hardened Firefox and voice:** privacy settings can stop voice from connecting on a local network. If you see "Couldn't connect voice to …", check `about:config`: `media.peerconnection.enabled` must be `true`, and `media.peerconnection.ice.no_host` must be `false` (it hides your local network address, which is exactly what voice between computers on the same Wi-Fi needs).

**Server settings:** they're the **🛠 Server** tab in **Settings** (the main menu's **Server settings** button opens it straight away). **Every gameplay number in the game is a setting** (about 380, in groups: World, Player, Health & XP, Food & traits, Stats, Monsters & animals, Items & tools, Blocks, Economy, Weapons, Magic): movement and gravity, health and XP, every food, dish, trait and stat effect, every creature's health, speed, damage and spawn odds, every tool and block price, break times, loot chances, coin values, the Zcash market, drones, ammo and so on. Among them, anyone playing can change: monster spawns, animals & birds, monster loot (Zcash and ammo drops), day length, fall damage and PvP; Zcash volatility, CONSUME delivery time and fee, and 3D print time; every gun's damage and fire rate, plus the shotgun's pellets and spread; and all of magic: max mana and regeneration (and how much Big Brain changes them), Wand/Staff potency, spell range, and every spell's mana cost, cooldown, damage, duration and other numbers. Type to search them, like the Q/E picker: names and section names (World, Economy, Weapons) by the start of a word, descriptions anywhere; Tab completes a name and Esc clears the search. Changes apply to everyone at once (everyone gets a message saying who changed what) and are saved with the world. In single player they're your world's settings.

**Trust:** this is built for friends. Each browser moves its own player and the server believes it, checking only basic things such as reach and cooldowns. Don't run it on the open internet.

## Single player

Opened without the server (for example with `serve.py` below, or any static file server), the game runs entirely in your browser and saves to `localStorage`, exactly as before.

ES modules have to be served over HTTP (opening `index.html` as a `file://` page won't work):

```sh
python3 serve.py
# then open http://localhost:8000
```

`serve.py` is plain `http.server` with caching turned off, so a normal reload always loads the latest code. If you use `python3 -m http.server` instead and the Play button stops responding after an update, hard-refresh with Ctrl+Shift+R.

Three.js r160 is loaded from jsDelivr through the import map in `index.html`, so the first load needs internet.

### LibreWolf / Firefox with fingerprinting protection

`privacy.resistFingerprinting` (on by default in LibreWolf) caps WebGL at 2048×2048 pixels. The game detects this, renders at the allowed size, and shows a warning on the start screen. For full sharpness, exempt just this game: open `about:config`, add `localhost` to `privacy.resistFingerprinting.exemptedDomains`, make sure `webgl.min_capability_mode` is `false`, and reload. Protection stays on for every other site.

## Controls

| Key | Action |
|---|---|
| WASD / mouse | Move / look |
| Space | Jump, swim up, fly up |
| Shift | Sprint (also flies faster) |
| C | Crouch on land (slow, lower view, won't walk off ledges), fly down, or dive when swimming |
| B | Buildy Boi mode on/off (takes 10 seconds; press again to cancel) |
| F | Toggle flying (Buildy Bois only) |
| **Q** / **E** | Choose what's in your **left** / **right** hand |
| Left / right click | Use your left / right hand (see below) |
| Middle click | Put the block you're looking at in your right hand |
| G (hold) | Wash any dirty dish (stand next to water) |
| T | Chat: type a message to everyone (Enter sends it; it shows in everyone's message log) |
| Tab | Map of everyone's phones |
| I | Character sheet: stats, traits and conditions down the left, and you, seen from the front, on the right (drag to turn around) |
| U | Take off the armor you're wearing |
| V | Voice menu: your microphone, and each player's volume and "nearby only" (multiplayer) |
| Z / X (hold) | Whisper / shout: how far your voice carries for players who have you on "nearby only" |
| / | Open the console to type a command (see below) |
| J | Bestiary: every creature, with a picture and a short description |
| L | Quest log: your quests, how far along they are, and what they pay |
| F3 | Toggle the info panel (hidden at first) |
| P | Camera: first person (your own body, holding what's in your hands, exactly as others see it), behind you, facing you |
| Esc | Main menu; in any menu, back one step; in the main menu, back to the game |

### Hands

Tap **Q** or **E** to open your inventory as a compact grid of tiles on the left or right of the screen (counts in the corner of each tile; the highlighted item's description shows underneath). Click a tile, use the **arrow keys** to move around the grid, or start typing to filter. **Tab** completes the name, and pressing it again cycles through matches (Shift+Tab goes back). **Enter** picks the highlighted item and **Esc** cancels.

**Hotbars:** each hand has a hotbar of 8 slots, just above the health bar (the left hand's on the left). Drag things from the inventory (tap Q or E) onto either hotbar, drag a slot onto another to swap them, or drag it off the bar to clear it. Then **hold Q (or E) and scroll** to switch that hand to the next thing on its hotbar. Hotbars are saved with your Player.

Each mouse button uses its own hand, and what the hand holds decides what the click does. The exception: **right-clicking an interactive block** (door, trapdoor, bed, Cold Wallet, 3D Printer) always uses the block, and doesn't use whatever is in your right hand. To break one, use your left hand.

| In hand | Click does |
|---|---|
| Empty hand / shovel / pick / axe / sword / pillow | Hit a monster; hold to mine a block (the tool sets the speed) |
| A block | Place it (stairs climb, and doors face, away from you) |
| A gun | Hold to fire (needs ammo) |
| Grappling Hook | Hook the block you're aiming at; hold the button to be reeled in, let go to drop |
| Empty hand, Wand or Staff (with a spell picked) | Cast the spell (see Magic) |
| Phone | Open CONSUME, the shop |
| Hackysack | Throw it |
| Food (steak, liver, bread, milk, cheese) | Eat it |
| Dirty dish | Hold next to water to wash it |

## Survival

A full day lasts 10 minutes. Monsters only spawn **in the dark**: never during the day (from dawn until after sunset) except down in caves, and never within 8 blocks of a lava lamp, in any direction. At night they appear 24–40 blocks away:

- **Zombie**: shambles toward you and punches.
- **Skeleton**: keeps its distance and shoots arrows when it can see you.
- **Seed Oil**: a golden oil blob that hops at you and hurts on contact. Kill one and it splits into two smaller ones (size 3, then 2, then 1).
- **Clerk** and **Mildew** (the Backrooms only): parts of the Backrooms are dark (rooms without a light), and these come out of them at any hour. The Clerk is a very tall, faceless office worker who walks slowly at you with its arms out and hits hard; the Mildew is a low patch of damp carpet that skitters fast.
- **Knife Penguin**: lives where it's cold (taiga, snow and ice), waddles up to you holding a kitchen knife and uses it. It drops a Raw Penguin. Roasted, it heals, but doesn't let you flap: flight was never an option.

- **Brainrot** (original creatures, with sing-song pseudo-Italian names, and they chant): the **Pomodorino Pugnolino**, a boxing tomato that rushes in with quick jabs; the **Lavatricio Giraffone**, a washing machine on giraffe legs, slow and tough, that kicks hard; and the **Ventilone Fenicotterone**, a one-legged flamingo with a desk fan for a head whose pecks barely hurt but knock you flying.
- **Tung Tung Tung Sahur**: a wooden log with a wide stare and a big wooden bat. It only comes out in the last hours of the night (from 03:00 until dawn; a server setting), drumming *tung, tung, tung* as it comes to get you up for sahur, and burns away at sunrise.

Zombies and skeletons burn in direct sunlight. Creatures that walk have to swim across water: they float chest-deep and go at half speed (except knife penguins, which are much faster in water than on land), so a moat slows them down.

During the day, **cows** wander in herds on grass. Hit one and it runs (it takes a good ten punches). Hold a **Bucket** (3D Printer or CONSUME) in your left hand and right-click a cow to **milk** it: a glass of milk, and that cow has none left for a minute. Kill one and it drops 1–2 steaks or a liver, and usually a **glass of milk** or some **cheese**. Walk over the drops to pick them up, then eat them to heal. You can only eat when you're hurt, so food isn't wasted. Your food is saved along with the world.

**Birds** of five kinds fly about by day: **bluebirds**, big flocks of **scaly-breasted munias**, quick yellow **finches**, round slow **crusty-titted nutmunches** (inland), and **seagulls** (only where there's water nearby) over water and beaches, which swoop in and steal food out of your hand. They wheel a few blocks up and sometimes land to peck at the ground (get within 5 blocks and they take off). Shoot one down, or catch one on the ground, and it drops a **Roast Bird**. Eating it (you can, even at full health) makes you **flappy for 30 seconds**: every tap of **Space** in mid-air is a flap upward. Tap about three times a second to climb, slower to glide down.

**Blocks and Buildy Boi mode:** normally you only have the blocks you've collected. Break a block and it goes into your inventory; place one and it's used up. Crafted blocks (planks, glass, brick, stairs, slabs, fences, ladders, trapdoors, doors, lava lamps, beds, Cold Wallets and 3D Printers) can also be printed at the **3D Printer** in batches, or ordered from **CONSUME** on your phone. Press **B** to become a **Buildy Boi**: after 10 seconds you put on a little yellow hard hat (everyone can see it) and get **every item, unlimited**: every block, tool, weapon (the Fantasy Town's too), food, scroll and all the ammo, and nothing gets used up. Plus **flying** (F). Taking the hat off takes the free things with it (and any armor you put on as a Buildy Boi). Buildy Bois are **invincible** (nothing hurts them, and falling out of the world just puts them back at their spawn point) and **mobs ignore them**: monsters don't chase them, seagulls don't steal from them, and birds and pets don't notice them. They can still use weapons, spells and throwing. Press B again to take the hat off, which also takes 10 seconds.

**Wheat** grows in fields on grassy land. Walk through it; break it (instantly by hand) and it drops **bread**.

| Food | Heals | Contains |
|---|---|---|
| Raw steak (cooked: 8) | 3 | |
| Roast Bird | 2, and 30 s of flapping | |
| Liver | 10 | |
| Bread | 5 | gluten |
| Glass of Milk | 4 (leaves a dirty glass) | lactose |
| Cheese | 7 | lactose |

**Characters:** each Player can have up to 5 characters (a server setting), each with its own name, inventory, skills and saves. After signing in you play your last character straight away; **Switch character** on the main menu shows the list (Play, Delete, New character). The **character creator** sets the name, the **stats** (every one starts at 5 and you place 15 more points; any you don't place become attribute points) and the **look**: head (Normal, or the novelty heads Smug Shiba, Chiseled Hunk, Stone Head and Frog), skin (Fitzpatrick types I to VI), hairstyle and hair colour, two brows or a unibrow, and shirt and trouser colours, with a turning 3D preview. A character's stats and traits are its own for good.

**Stats:** seven RPG-ish stats. Press **I** for your character sheet. **Every level-up gives you 3 attribute points** (a server setting): click the **+** next to a stat on the character sheet to add one. Points you add stay with you from life to life, on top of whatever you roll. 

| Stat | Spoofing | What it does (per point above/below 10) |
|---|---|---|
| Mog | Strength | ±4% damage with melee weapons and bows |
| Cracked | Dexterity | ±1.5% movement speed; above 10, a 1% chance per point (up to 40%) to dodge an attack from a mob, weapon or spell (never falls, lava or blasts) |
| Big Brain | Intelligence | ±5 max mana and ±0.3 mana a second (see Magic) |
| Rizz | Charisma | Fantasy Town shopkeepers give you ±3% off (or on), and quest rewards are ±3% bigger (or smaller). The 3D Printer and CONSUME don't care |
| Built Different | Constitution | ±1 max health; above 10, a 2% chance per point (up to 40%) to shrug off a debuff (hostile spells: chill, blind, shrink, enlarge, polymorph, hallucinate; and food reactions: headaches and upset stomachs); debuffs that do land last 3% shorter (or longer) |
| Tallness | Height | ±3% reach, and you look taller or shorter (2.5% a point). Over 10, each step under a low ceiling has a 2% chance per point over 10 of bonking your head (1 damage) |
| Touch Grass | Wisdom, kind of | no effect yet |

**Traits:** every time you spawn (your first join and every respawn) you might be born **gluten intolerant** (25% chance) or **lactose intolerant** (30%), or both. **Falls hurt:** landing on something solid after dropping more than 3 blocks costs 1 health per block beyond 3 (the **Fall damage** server setting scales this, or turns it off). Water landings, ladders, flying, flapping and the grappling hook don't count. You might get **fall healing** (20%): those same drops *heal* you instead, 1 health per block past the first 3, with a pop-up saying "That was weird...". Or you might be **gravity resistant** (15%): you feel half as much gravity, so you jump about twice as high and fall slower, and you never take fall damage. A message tells you, the character sheet (I) lists them, and the Q/E picker warns you about food you can't eat.
- **Gluten intolerant + bread:** no healing, and a **20-second headache**: the screen throbs with a red border.
- **Lactose intolerant + milk or cheese:** no healing, 3 damage straight away and 1 more every 4 seconds, **half speed**, and you **poop everywhere** for 24 seconds. Everyone can see the mess; it clears up after two minutes.

**Cats and dogs** are rare. Only one is around at a time, turning up every few minutes at any time of day, and it comes over to keep you company. Dogs stick close; cats keep a little more distance. While any pet is within 5 blocks, you have allergies: you **cough** (1 damage) or **sneeze** (2 damage, and your head jerks). More pets nearby means more symptoms.

**Dishes:** eating leaves dirty dishes (a steak leaves a plate and cutlery, a liver leaves a bowl, milk leaves a glass), and Seed Oils sometimes drop greasy ones. Hold a dirty dish in a hand and hold that button next to water (or hold **G** to wash any of them), 1.2 seconds each, for points in the Dishwash skill: 1 point per dish.

**Skills and levels:** everything you get good at is a skill. **Every monster or animal you kill earns a point in the weapon that made the kill**: a sword, an empty hand (Punch), a gun or bow, a rocket's blast, or a spell (it counts for the Wand or Staff you cast it with, or Magic if your hand was empty). **Every block you break with the right tool** (axe on wood, pick on stone, shovel on dirt) is a point for that tool, and so is every use of the Tiller, Sprayer or Weed Torch that changes something (tilling, watering dry soil, burning weeds). Planting a seed is a point in Plant. Washing a dish is a point in Dishwash. Points are silent: check the character sheet. The character sheet (I) lists the skills you've used, best first, and **your best skill is your title**: a Wand user is a *Wander*, a rocket fan a *Rocket Launcherer*, a dish washer a *Dishwasher* (with none yet you're an *Adventurer*). **Your level comes from your total points**: level 2 at 100, then each level needs 50 more than the last (250, 450, 700, 1000...). Each level raises your max health by 2, up to 40. (Saves from before skills keep their level: the old XP turns into Dishwash points.)

**Zcash coins** don't lie about in the wild: hostile mobs sometimes drop them when they die. Walk into a coin to collect it: each is worth a random 0.01 to 1.00 ZEC. **When you die you drop a backpack** where you fell, holding everything you carried: your items, blocks, food, ammo, scrolls, unfired pottery, the armor you wore and the Zcash in your wallet. Only you can pick it up (walk into it; a beam of light marks it for you), and it's gone after 5 minutes (a server setting). For Zcash that's always safe, place a **Cold Wallet** block and right-click it to move ZEC into cold storage, which survives death. Every Cold Wallet opens your own storage (other players can't touch it), and the amount stored shows next to your wallet as ❄.

**Beds:** place a **Bed** (two blocks long: the foot goes where you click and the pillow end points away from you) and right-click it to make it your spawn point: when you die you wake up on it instead of at the world spawn. Your bed is marked on the **Tab** map (pinned to the edge with its distance when it's far away). If the bed has been broken or something is blocking the space above it, you wake up at the world spawn and the game tells you. Break beds with the left hand (an axe is fastest); either half takes the whole bed. Your total is in the top-right corner. They're just an in-game collectible with nothing connected to real crypto, and the coin uses our own pixel "Z" design, not the official logo.

**Starting out:** new players start with nothing but their **phone**. Earn Zcash from the coins monsters drop, then order what you need from **CONSUME**, the shop app on your phone: everything in the game (tools, weapons, the Fireball Wand, ammo, food and every block, including a 3D Printer) is there. Orders cost a **10% delivery fee** and take **5 minutes**; then a **delivery drone** flies in, hovers over you and hands the package down into your inventory. The phone counts down what's on the way (🚁 while the drone is flying). Orders keep counting while you're offline, and a drone waits while you respawn.

**3D Printer and tools:** put a 3D Printer in a hand, place it, then right-click it to print tools, the Wand and Staff, ammo and crafted blocks. A print takes **5 seconds** and has no fee. The printer and CONSUME both show their catalogue as tiles, like the Q/E picker: type to search, arrows to move, click to select, and Enter (or double-click, or the button) to buy. Prices are in **US dollars** and paid for in **Zcash at the exchange rate of the moment you press Print**, and that rate is wild: it lurches every second, with the odd 30–80% crash or pump, drifting around $30 per ZEC. The printer shows the live rate and a price chart, and your wallet shows what your ZEC is worth in dollars. Buy the dip. (In multiplayer everyone shares the same market.)

| Tool | Price | What it does |
|---|---|---|
| Shovel | $30 | Digs dirt, grass and sand 5× faster |
| Pick | $50 | Breaks stone and brick 5× faster |
| Axe | $40 | Chops logs and planks 5× faster, and hits for 8 |
| Sword | $60 | 12 damage per hit (bare hands do 5), and cuts leaves faster |
| Couch Pillow | $20 | Only 1 damage, but huge knockback, plus feathers |
| Hackysack | $10 | Left click throws it. It bounces, hits for 3, and you walk over it to get it back |
| Flashlight | $25 | Lights a cone in front of you at night (other players' flashlights light your view too) |
| Compass | $20 | Hold it to see a dial at the top of the screen: the red needle points north, the gold one to your current quest (the one you took last): the lost thing, the garden to till, or whoever is waiting for you. Also sold by the Fletcher |
| Grappling Hook | $60 | Hooks a block up to 40 away and reels you in while you hold the button |
| Pistol | $40 | 9 per shot, accurate. Bullets |
| Shotgun | $90 | 8 pellets × 6, brutal up close. Shells |
| Machine Gun | $150 | 6 per shot, ~11 shots a second while held. Bullets |
| Rocket Launcher | $250 | Exploding rockets: blows up blocks too, mind the splash. Rockets |
| Sniper Rifle | $350 | 45 damage (90 to the head), reaches 220 blocks, bolt-action. Wild from the hip; **right-click for the scope** and keep clicking: 5×, 10×, 20×, then off. Rifle rounds |
| Railgun | $400 | 60 damage, instant, goes through everything in a line. Slugs |
| Overcharge Cannon | $900 | A slow green orb that zaps everything near its path, then detonates hugely. 30 cells a shot |

**Biomes:** the land is plains, forest, jungle, desert, taiga and swamp, with special zones here and there: the Concrete Jungle, the Abandoned City, Hell, the Backrooms, the **Neon City** (for now built like the Concrete Jungle; the cyberpunk city is coming) and the **Fantasy Town**. Biomes are big: crossing one can take a few minutes. (They used to be ten times smaller. Worlds made before that keep the old, smaller terrain wherever anyone had built (every chunk with player changes, plus one chunk around it), and the new land eases into it over about 32 blocks, so your builds still stand on the ground they were built on. Likewise the Ball Pit is gone from new land, but ball pits where anyone had built stay, and its Foam and Ball Pit Balls blocks are still in the game.)

**Caves:** under natural land there are caves: winding tunnels at different depths, bigger caverns (some deep ones with pools of lava), and now and then a **sinkhole** opening down from the surface. They never reach towns, cities or the other special zones, and always keep a thick roof under seas and lakes. **It's dark down there, day or night:** anything under cover more than a couple of blocks below the ground gets darker the deeper it is, so bring a Flashlight or lava lamps. Monsters come out of the dark in caves at any hour (never within 8 blocks of a lava lamp). Worlds made before caves keep everything you've built exactly as it was: every chunk with an edit, plus one chunk all round it, stays without caves.

**The Fantasy Town:** a large town of cobbled streets lit by lamp posts (so monsters don't spawn in the middle of it), timber-and-plaster houses, gardens and covered wells. Every 120 blocks or so there's a **market square** with a fountain and five shops. Each shop has a counter with its sign painted on it; **right-click the counter** to see what's for sale. You pay in Zcash at the exchange rate of the moment (Rizz haggles here, and only here), with no fee and no wait. Their goods are sold nowhere else: you can't print them or order them.

| Shop | Sells |
|---|---|
| Blacksmith | Dagger ($25, 8 damage), Sword ($60), Longsword ($140, 16), Greatsword ($260, 24, two-handed); Leather Armor ($50, hits hurt 15% less), Chainmail ($140, 30%), Plate Armor ($320, 50%, but 10% slower) |
| Healer | Healing Potion ($12, +10 health), Greater Healing Potion ($30, +25), Antidote ($10: cures headaches, lactose trouble, chills and hallucinations) |
| Tavern | Hearty Stew, Meat Pie, Bread, Cheese, Honey Cake, Ale, Mead, Cider and Milk. **Upstairs are six rooms with a bed in each: right-click one to make it your spawn point** |
| Fletcher | Shortbow ($45), Longbow ($120), Crossbow ($200), all two-handed, and Arrows (20 for $6) |
| Wizard | Wand, Staff, **Rune Wand** ($260, magic 60% stronger), **Archmage Staff** ($600, 120% stronger, two-handed), Mana Potion ($15, +40 mana), and a **scroll** of every spell |

**Townsfolk and quests:** every market square has its people. The five **shopkeepers** stand behind their counters, and a handful of **villagers** stroll about the plaza. They're there whenever you are (the same names and faces every visit) and can't be hurt. **Click a townsperson** (either button) to talk. A **❗** over someone's head means they have a job for you:

- the **Blacksmith** wants coal and iron, copper or silver ore; the **Healer** mushrooms, Glowcaps, yarrow, wild mint, garlic or thyme; the **Innkeeper** ingredients (vegetables, wheat, steak, milk, fish); the **Fletcher** sticks, feathers, cord and plant fiber; the **Wizard** Glowcaps, sulfur, silver ore and mushrooms;
- **villagers** lose things about the town (follow the golden beam, walk up to it, take it back), want a patch of **garden tilled** (inside the green ring; they'll lend you a Tiller if you haven't one), or are just hungry for something cooked.

**Hiring villagers:** it works the other way round too. Talk to a villager and pick **Hire for a job…**: an **errand** (they fetch 1 to 20 of an ore, coal, sulfur, mushrooms, Glowcaps, yarrow, mint, sticks, fiber, feathers or wheat, for 150% of what it's worth to quest givers) or **gardening** (they borrow your Tiller and till up to 32 blocks around the last block you tilled yourself, $0.50 a block). You pay in ZEC up front, they leave the market, and when they're back (2 minutes plus 10 s an item or 4 s a block) the goods go straight into your inventory, or the ground is tilled and you get your Tiller back. Two villagers can work for you at once; the quest log (L) shows them under **Working for you**. Every number is a server setting (Jobs).

Coal and ore turn up now and then when you **mine stone** (silver rarely), sulfur in Hell's **brimstone**, yarrow and wild mint when you **cut grass**, mushrooms when you **dig dirt or grass** (more in swamp mud, where the rare **Glowcap** grows too), and birds leave **feathers**. Go back when you're done (**❓** over their head): you're paid in Zcash at the rate of the moment and get **Questing** skill points (title: *Hero*), and they'll have another job for you after a few minutes. You can have five quests at once, one per person; the quest log (**L**) and the Tab map show them, and you can give one up there. Rewards, sizes, the cooldown, villagers per market and every find chance are Server settings (Quests, Gathering).

**Greatsword:** two hands, two attacks. The **left button** is a wide horizontal slash that hits everything in front of you (within 3.5 blocks, across 120°) for 75% damage; the **right button** is an overhead chop at one target for 175% damage that takes twice as long to recover from. All of it is in Server settings (Weapons).

**Bows:** hold the button to draw a Shortbow (0.6 s) or Longbow (1 s), and let go to shoot. A full draw shoots fastest and hardest; a part draw is slower and weaker, and letting go before a quarter of the way does nothing. The Crossbow is cocked, so it fires on a click. **Arrows and bolts can be picked up again:** they stick in the block they hit, lie on the ground by a player they hit, or stay stuck in a creature (you can see them) until it dies and they fall out. Walk over one to get it back. One in ten breaks. Draw times, the least draw and the break chance are Server settings (Weapons).

**Armor:** hold it and click to put it on (everyone can see it: a leather vest, a chainmail shirt and hood, or a full suit of plate with a helmet). Whatever you had on goes back in your inventory, and **U** takes it off. It stacks with Stoneskin, goes in your backpack when you die, and the character sheet (I) shows what you're wearing. **Bows** fire with the left button like guns, and the right button aims. Their arrows really fly: they drop over distance, so aim high for long shots. **Scrolls:** hold one and click to cast its spell for free (no mana); the scroll is used up. Shop counters can't be broken or blown up. Every price, the armor values, bow arrow speed and drop, potion strengths and scroll potency are Server settings.

**Console:** press **/** to type a command, then **Enter** to run it or **Esc** to close. **Tab** completes command names, player names and places; **↑/↓** go through what you typed before. The game keeps running while you type.

| Command | What it does |
|---|---|
| `/help` | Lists the commands |
| `/teleport x z` | Teleports you to that spot, standing on the ground (`/tp` for short) |
| `/teleport x y z` | Teleports you to exactly there. `~` means where you are now: `/tp ~ ~20 ~` puts you 20 blocks up (mind the fall) |
| `/teleport Bob` | Teleports you to a player (the start of a name is enough if only one player matches) |
| `/teleport spawn` · `bed` · `town` | Teleports you to the world spawn, your bed, or the nearest Fantasy Town market |
| `/teleport Bob town` | Teleports someone else to any of the above (they're told who did it) |
| `/msg Bob hi there` | A private message to one player (also /tell, /w). Anything you type without a / goes to everyone |
| `/skip` | Skips ahead a quarter of a day (single player) |
| `/give` | Opens a searchable tile panel of every item in the game (the same one as the Q/E inventory): click or Enter gives you one, and it stays open so you can grab several |
| `/give <item> [count]` | Gives you any item, by its name or short id, in any case and spacing: `/give longsword`, `/give healing potion 3`, `/give arrows 100` (ammo counts rounds), `/give planks` (blocks come 64 at a time), `/give scroll:fireball`, `/give zcash 50`. Up to 9,999 |
| `/give Bob <item> [count]` | Gives it to someone else |
| `/summon <mob> [count]` | Summons up to 20 creatures a few blocks in front of you: `/summon zombie 5`, `/summon knife penguin`, `/summon seagull 3`. Seed Oils come as big as fits |
| `/summon Bob <mob> [count]` | Summons them next to someone else (they're warned) |

Anyone can use these; the **Teleporting** and **Cheat commands** (for `/give` and `/summon`) server settings (World) turn them off for everyone.

**Gardening:** grow your own food. Get a **Tiller**, a **Sprayer** and a **Weed Torch** (3D Printer or CONSUME) and packets of seeds (CONSUME): garlic, thyme, okra, artichokes, cabbage, carrots, onions, potatoes, pinto beans, peas and soybeans.
1. **Till:** click dirt or grass with the Tiller to turn a row of 3 blocks (along the way you're facing) into tilled dirt.
2. **Plant:** hold seeds and click the top of tilled dirt. Seeds won't grow anywhere else.
3. **Water:** click your garden with the Sprayer (a 3×3 patch goes dark and wet). Every morning at sunrise, each **watered** plant grows a stage (sprout, young, growing, ripe: three watered mornings from seed to harvest), and then the soil dries out, so water every day.
4. **Weed:** weeds sprout on tilled dirt and get worse every morning, from level 0 to level 3, and you can see them in the soil. **At level 3 they halve the harvest** of any ripe plant you pick from that dirt. Click with the Weed Torch to burn them off (a 3×3 patch; the plants don't mind).
5. **Harvest:** break a ripe plant (by hand, instantly) for 1-3 vegetables, which you walk over to pick up, and its seed back, sometimes two. Picking a plant early just gives the seed back. Every vegetable is food.

Each morning the message log says how the gardens did. Row length, sprayer and torch reach, growth and weed chances, how much fully grown weeds cut the harvest, harvest sizes and seed prices are all Server settings (Gardening).

**Crafting:** press **R** to craft by hand, anywhere. Breaking **leaves** sometimes drops a **stick** and breaking **grass** sometimes drops **plant fiber** (walk over them to pick them up). Recipes: **Cord** (3 fiber), **Planks** (a log makes 4), **Sticks** (a plank makes 2), **stone heads** (axe, pick, shovel, or a blade, each knapped from a stone block), and **stone tools**: a stick, a head and cord make a **Stone Axe**, **Pick** or **Shovel** (they work like the printed ones at half the speed) or a **Stone Knife**; two sticks, a blade and cord make a **Stone Spear**. Crafting trains the **Crafting** skill (title: *Crafter*); the recipe book (K) lists these too. The stick and fiber chances and the stone tool speed are Server settings.

**Cooking:** place a **Range** (stovetop and oven), a **Campfire** or an **Olive Press** (3D Printer or CONSUME) and right-click it to cook. The ingredients go in straight away and the dish lands in your food a few seconds later (walk away if you like). **Raw meat and fish heal less** than cooked, and raw meat has a 1 in 4 chance of upsetting your stomach; roast or grill them on a campfire or the range. The **recipe book** (**K**, or 📖 Recipes in the main menu) lists everything:
- Range: **Bread** (2 wheat, yeast, a bucket of water), **Baked Potato** (potato, butter, chives), **Cornmeal** (2 corn makes 2), **Tortilla Chips** (cornmeal, water: 2), **Poverty Nachos** (chips, cheese), **Tim's Nachos** (chips, pinto beans, jalapeño, cheese), **Jeddi's Hummus** (2 garbanzo beans, garlic, olive oil), and roasting.
- Campfire: roast meat (steak, liver, birds, penguin) and grill fish.
- Olive Press: **Olive Oil** (3 olives).

Ingredients: cut wild **wheat** (it gives wheat now, not bread), buy **yeast** and **butter** at the Tavern or on CONSUME, hold a **Bucket** in your left hand and right-click water for a **Bucket of Water**, and grow **chives, corn, jalapeños, garbanzo beans and olives** (new seeds on CONSUME) along with the old crops. A **Sink** block counts as water for washing dishes. Cooking trains the **Cooking** skill (title: *Chef*); times and the raw-meat chance are Server settings (Cooking).

**Fishing:** get a **Fishing Rod** (3D Printer or CONSUME), hold it and click on water to cast (up to 14 blocks, with nothing in the way). Wait: when a fish bites, the bobber dips under with a splash, and you have about a second to **click again** and reel it in. Too slow and it gets away (keep waiting for the next one); click early and you reel in an empty hook. Walking off, putting the rod away or pulling out your phone brings the line in. You can catch **minnows, perch, trout, salmon, catfish** (more at night) and, rarely, a **Golden Koi**, all of them food, plus the odd dirty dish someone threw in. Every catch is a point in the Fishing Rod skill (title: *Fisher*). Range, waits, bite time, junk chance and each fish's odds are Server settings (Fishing).

**Pottery:** make mugs, vases, plates, bowls and luminaries the way potters do.
1. **Clay:** digging turns up clay now and then: **White Clay** from sand, **Brown Clay** from dirt, grass and (often) mud, **Red Clay** from sandstone and brimstone. CONSUME sells all three.
2. **Throw** it on a **Pottery Wheel** (right-click the wheel, pick a shape and a clay). Mugs, plates and bowls take 1 clay, vases and luminaries 2.
3. **Trim** the thrown pot, on the wheel too.
4. **Bisque fire** trimmed pots in a **Kiln**: up to 8 at a time, 20 seconds. You can walk away while it fires. Bisque pieces can already be placed, if you like them plain.
5. **Glaze** a bisque piece at a **Glazing Table**: **Cobalt Stripes**, **Jade Speckle** or **Amber Zigzag**.
6. **Glaze fire** it in the kiln (25 seconds) to finish it.
7. **Luminaries:** right-click a placed luminary to light it (it glows and lights the room with a warm light) or put it out.

The Pottery Wheel, Kiln and Glazing Table come from the 3D Printer or CONSUME. Every throw, trim and glaze, and every piece fired, is a point in the **Pottery** skill (title: *Potter*). Clay costs, both firing times, the kiln load and the clay chances are Server settings (Pottery).

**Magic:** there are fifteen spells, and **you start knowing none of them.** Buy a spell's **scroll** from the **Wizard** in the Fantasy Town and read it (click with it): that teaches you the spell for good (the scroll is used up). After that you cast it with mana as below; reading another scroll of a spell you already know casts it for free. **Scroll the mouse wheel** to pick one (the spell bar is bottom left), then click with an **empty hand**, a **Wand** or a **Staff** to cast it. Picking "No spell" makes empty hands punch and mine again. Spells cost **mana**, which refills by itself; your **Big Brain** sets both how much mana you can hold (50 at average, ±5 per point) and how fast it refills (2 a second, ±0.3 per point). A Wand makes your magic **25% stronger** and a two-handed Staff **50% stronger** (damage and durations); both are printable or on CONSUME.

| Spell | Mana | What it does |
|---|---|---|
| 🔥 Fireball | 10 | A ball of fire that explodes, blocks and all |
| ✴️ Magic Missile | 12 | A homing bolt: 8 damage to the nearest target in front of it |
| 🧊 Icebolt | 15 | A shard of ice: 6 damage, and what it hits is chilled (half speed) for 4 s. Water it lands in freezes; it dusts the blocks around where it lands with snow |
| 🌨️ Blizzard | 45 | A ball of ice you throw (it arcs like a fireball); where it lands, a freezing storm 5 blocks across each way, for 8 s: 2 damage every half second and a chill to everything inside but you, and the water under it freezes over; it leaves snow behind |
| ⚡ Chain Lightning | 30 | 12 damage to what you aim at, then jumps to up to 4 more nearby (each hit 25% weaker) |
| 🔻 Shrink | 30 | Your target becomes a fifth of its size for 20 s, and so do its attacks and speed |
| 🔺 Enlarge | 30 | Your target grows six times bigger for 20 s and hits six times harder (as big as there's room for) |
| 🌀 Hallucinate | 25 | Your target sees monsters that aren't there for 20 s: a monster ignores you and fights thin air; a player gets chased by harmless phantoms only they can see |
| 👶 Polymorph | 35 | Your target becomes an immobile, coughing infant for 10 s |
| 🪨 Stoneskin | 25 | You take 40% less damage for 30 s (50% with a Wand, 60% with a Staff) |
| 👻 Invisibility | 30 | Monsters and players can't see you for 20 s, until you attack or cast at something |
| 🕊️ Flying | 35 | You can fly for 20 s: F to take off, Space and C for up and down. A warning comes 3 s before it wears off; then you fall |
| ✨ Teleportation | 25 | Blink to the spot you're looking at, up to 40 blocks away (onto the block you aim at, or beside it) |
| 🐉 Dragon's Breath | 30 | A cone of fire 7 blocks long and 50° wide: 7 damage to everything in it (not through walls) |
| 🙈 Blind | 25 | A player's view blurs over for 10 s; a monster loses track of everyone for 10 s |

Snow from Icebolts and Blizzards melts after about three minutes, and you can walk through it or build right over it.

These are the defaults: every number (mana, regeneration, potency, costs, cooldowns, damage, durations, ranges) is in **Server settings** under Magic. Targeted spells that find nothing to hit cost nothing. Shrink and Enlarge replace each other. In PvP, other players can be shrunk, enlarged, made to hallucinate, polymorphed (they can't move or act) and zapped.

**Two-handed guns:** the shotgun, machine gun, rocket launcher, railgun and Overcharge Cannon take both hands (only the pistol is one-handed). Each gun fires with its own hand's button (a two-handed gun with the left). **Holding the right button aims down the sights** (a 2× zoom, a mouse slowed to match and tighter spread; the zoom is the Aiming zoom server setting) when your right hand is free for it: with a two-handed gun, or a one-handed gun in your left hand and nothing in your right. If your right hand holds something, the right button uses that instead. Right-clicking a door, bed and so on still uses it.

**Headshots:** a bullet, shotgun pellet, railgun slug or arrow that hits the top fifth of a player or creature is a **headshot**: double damage, and a deep announcer voice tells you **"HEADSHOT!"** (your browser's speech voice, so it sounds a little different on each computer). Both numbers are Server settings (Weapons).

**Ammo** is sold by the box at the 3D Printer and on CONSUME, and monsters sometimes drop an **ammo crate**: walk over one for a box of bullets (30), shells (8), rockets (4), railgun slugs (4), energy cells (60) or rifle rounds (10). The guns in your hands and their ammo are shown bottom right. Rare glowing purple orbs give you **Power Surge**: 30 seconds of 4× damage from everything you do, with a pulsing purple border (and you glow purple to everyone else).

**Building blocks:** besides the plain cubes you can place **lava lamps** (they glow, lighting up the area around them at night, and monsters won't spawn within 8 blocks of one, above, below or around it; you can walk through them), **doors** (two blocks tall; right-click to open or close), **plank and stone stairs** (walk up them without jumping) and **plank and stone slabs** (half-height; also walkable without jumping), **fences** (join up with each other and with walls; too tall to jump over, so they keep you in and monsters out), **trapdoors** (a hatch lying on the floor; right-click to open or close) and **ladders** (place on the side of a block; walk into them or hold Space to climb, C to climb down, and you slide down slowly if you just hang on).

Breaking blocks takes time: hold the button of an empty or tool-holding hand. By hand, dirt takes about half a second and stone 2.5 seconds. Use **Q**/**E** to pick up the tools you've printed. The pillow and hackysack work on monsters, and on other players in multiplayer.

**Health:** you start with 20 health, and **it never comes back on its own: eat to heal** (see the food table), or respawn. Fireball explosions hurt everything nearby, including you.

**Phone:** it's always in your inventory. Hold it and click to open it (swirly wallpaper included): it's **CONSUME**, the shop. Chat is **T**; the map is **Tab** (invisible players don't show up on it).

**Menus and Esc:** clicking outside a pop-up (the Q/E picker, the printer, a shop, talking to someone, the quest log, pottery, cooking, the Cold Wallet, the recipe book, the bestiary, Settings or the phone) closes it and puts you back in the game. In the game, **Esc** opens the **main menu** (Resume, Settings, Server settings, your name, New world). In any menu, Esc goes back one step (Settings or Server settings to the main menu; the printer, a shop, the phone and the like to the game). In the main menu, Esc goes back to the game: browsers only let a page take the mouse back on a click, so a "Click to return to the game" prompt comes up, and one click puts you back in.

**Settings** (main menu, or V for the Voice tab), in tabs: **Controls:** mouse sensitivity and a list of every key. **Sound:** volume (100% to start), music volume, how much rooms echo, birds and crickets on or off. **Voice:** your microphone and each player's volume and Nearby only (V opens this tab). **Display:** font size (all the text in menus, messages and labels; it starts at 125%), field of view, camera shake, the F3 info panel, the message log. **Graphics:** render distance and resolution. Your choices are saved in this browser.

**Message log:** every notification (pickups, healing, XP, purchases, deliveries, texts from other players, console replies, who joined voice) and **everyone's player events** (who joined or left, who changed their name, who reached a new level, and every death and what caused it: "Sam was killed by a Zombie", "Sam was killed by Alex (Longsword)", "Sam died from falling 14 blocks", "Sam burned to death in lava", "Sam fell out of the world"...) appears in a small log in the bottom right. Repeats count up (×3) instead of filling it, it fades a little when nothing's happening, and you can scroll back through the last 100 lines when your mouse is free. Settings > Display hides it.

**Sound:** every sound is synthesised in the browser as it plays (no audio files): footsteps that depend on what you walk on, block and combat sounds, creature noises, explosions and fireballs, the printer, and birds by day or crickets at night when you're outdoors. Sounds in the world are **3D**: they come from where they happen, and **walls between you and a sound muffle it**. The place you're in changes how everything sounds: **small rooms, halls, caves** and **streets between tall buildings** each have their own echo, everything goes dull **underwater**, and **Hell** rumbles. Rockets, fireballs, magic missiles, arrows, orbs and delivery drones **hum as they fly, with the Doppler effect** (higher as they come at you, lower as they go). **🎧 3D sound for headphones** (Settings > Sound) is on by default: realistic positioning, including above and below. It's made for headphones; on speakers, untick it for plain left/right panning.

**Music:** made up as it plays, like every other sound (there are no audio files), in four moods that follow you around: wistful pastoral music in the wilderness (soft strings, a harp and a breathy flute, in a wandering minor key), a medieval bard tune in the Fantasy Town (a drone, lute, frame drum and a recorder playing a little AABA melody it makes up for each piece), something creepy in caves, Hell and the Backrooms (beating drones, far-off bells, rumbles), and techno in the Neon City. Each piece ends with a rest before the next, and moods crossfade as you move between places. **Settings > Sound > Music** sets how loud it is (60% to start; 0 turns it off).

In single player, the world seed, your block edits and your progress are saved in `localStorage`; click **New world** on the pause screen to start over. In multiplayer the server keeps the shared world.

## Layout

- `src/blocks.js`: block IDs, atlas tiles, see-through and solid flags, placeable blocks, mining hardness
- `src/noise.js`: seeded simplex noise and hashing
- `src/world.js`: 16×80×16 chunks, terrain and tree generation, legacy (pre-big-biome) chunks, edit persistence, voxel raycasting
- `src/biomes.js`: which biome each column is in (and the first generation's smaller map, for legacy chunks), ground heights, city and backrooms layouts
- `src/commands.js`: the `/` console's commands (`/help`, `/teleport`, `/give`, `/summon`), run by the game
- `src/townplan.js`: the Fantasy Town: streets, houses, gardens, wells, and market squares with the five shops
- `src/npcs.js`: the town's people: shopkeepers behind their counters and villagers wandering the market squares
- `src/quests.js`: what the townsfolk ask for, rewards, and the quest records players keep
- `src/forage.js`: coal, ore, sulfur, herbs, mushrooms and feathers found while mining and digging
- `src/mesher.js`: face-culled chunk meshes with per-vertex ambient occlusion
- `src/body.js`: AABB-vs-voxel physics shared by the player and mobs (shaped blocks via `SHAPES`, steps up slabs and stairs)
- `src/weapons.js`: guns, ammo crates, Power Surge and the grappling hook
- `src/lamps.js`: lava lamp models; their light goes through `setLamps` in `flashlight.js`
- `src/player.js`: input, walking, swimming, flying, health
- `src/mobs.js`: mob AI, spawning, arrows, blast damage
- `src/bestiary.js`: the Bestiary's entries (J)
- `src/fireballs.js`: fireball projectiles (and magic missiles) and block-destroying explosions
- `src/music.js`: the generated music (pastoral, bard, creepy and techno moods) and its scheduler
- `src/jobs.js`: hiring villagers for errands and gardening
- `src/spells.js`: the spells, mana from Big Brain, and Wand/Staff potency
- `src/drones.js`: CONSUME delivery drones
- `src/items.js`: food, dishes, tools (dollar prices), loot, dropped items, and the hand inventory (search and Tab completion)
- `src/market.js`: the wild ZEC/USD exchange rate and price conversion
- `src/daycycle.js`: time of day and daylight level
- `src/mobModels.js`, `src/effects.js`, `src/sky.js`: Three.js visuals for mobs, particles and explosions, and the sky
- `src/textures.js`: procedurally painted 16px tile atlas and block icons
- `src/picker.js`: the Q/E hand picker: a tile grid with search, Tab completion, arrows, click and Enter
- `src/game.js`: the authoritative game (world edits, mobs, items, health, inventories, saves). The server runs it; single player runs it in the browser
- `src/net.js`: connects to the server if there is one, otherwise starts a local game
- `src/accounts.js`: Players (accounts) kept with the world: create, sign-in check, recovery codes, Admin tools
- `src/account.js`: signing in on the title screen (Create Player, Recover Player)
- `src/avatars.js`: how other players look
- `src/audio.js`: synthesised sound effects and 3D positioning
- `src/flashlight.js`: the shader hook that lets flashlights light up the world
- `src/phone.js`: the phone's screens (texts, map, CONSUME) and notifications
- `src/voice.js`, `src/pitchshift.worklet.js`: server voice in the browser: a WebRTC mesh (one connection per pair), per-player volume and distance, and pitch shifting for shrunk and enlarged players
- `src/acoustics.js`: walls between you and a sound, what kind of space you're in, and the echo/underwater chain (shared by game sounds and voice)
- `src/voiceroom.js`: the game's side of voice: who's in it, and relaying the connection set-up
- `src/map.js`: the Tab map
- `src/main.js`: the client: rendering, your own movement, input, HUD; turns actions into messages for the game
- `server/index.js`: the multiplayer server (static files + WebSocket at `/ws`, saves to `DATA_DIR`)
- `server/ws.js`: a minimal WebSocket implementation on Node's built-in modules
