// The Bestiary (J): a short field guide to everything that walks, hops, waddles or flies.
// Plain data, no Three.js or DOM; main.js draws it (with a picture of each mob's model).

import { MOB_TYPES } from './mobs.js';

/** How the guide says where something goes (mobs.js `moves`). */
export const MOVE_NAMES = { aquatic: 'aquatic (dives)', natatorial: 'natatorial (swims at the surface)', terrestrial: 'terrestrial', aerial: 'aerial (flies)', fossorial: 'fossorial (burrows)' };

/** In the order they're listed. `when` is when and where you'll meet them; `drops` what they leave. */
export const BESTIARY = [
  { type: 'zombie', name: 'Zombie', group: 'Monster', when: 'Night, anywhere',
    drops: 'Sometimes Zcash or ammo',
    desc: 'Shambles toward you with its arms out and punches. Sunrise sets it on fire, which it handles poorly.' },
  { type: 'skeleton', name: 'Skeleton', group: 'Monster', when: 'Night, anywhere',
    drops: 'Sometimes Zcash or ammo',
    desc: 'Keeps a polite distance and shoots arrows at you. Also burns in daylight. Rattles when it thinks.' },
  { type: 'seedoil', name: 'Seed Oil', group: 'Monster', when: 'Night, anywhere',
    drops: 'Greasy dishes, sometimes Zcash or ammo',
    desc: 'A golden blob that hops at you and hurts on contact. Kill it and it splits in two, and again, and again.' },
  { type: 'penguin', name: 'Knife Penguin', group: 'Monster', when: 'Night, anywhere',
    drops: 'Roast Penguin (no flapping: flight was never an option), sometimes Zcash or ammo',
    desc: 'Waddles up to you holding a kitchen knife and uses it. Flight was never an option, so it went with this.' },
  { type: 'clerk', name: 'Clerk', group: 'Monster', when: 'The Backrooms, in the dark rooms, any time',
    drops: 'Sometimes Zcash or ammo',
    desc: 'A very tall office worker in a yellowed shirt and a loose tie, with no face at all. It walks slowly, it doesn\'t stop, and it hums along with lights that aren\'t there.' },
  { type: 'mildew', name: 'Mildew', group: 'Monster', when: 'The Backrooms, in the dark rooms, any time',
    drops: 'Sometimes Zcash or ammo',
    desc: 'A patch of damp carpet that got up and left. Low, wide and quick; you hear the squelch before you see it.' },
  { type: 'amalgam', name: 'Amalgamation', group: 'Monster', when: 'Night, anywhere',
    drops: 'Sometimes Zcash or ammo',
    desc: 'Three creatures that got stuck together and decided to make the best of it. Every one is a different three. It lurches about on whichever legs agree, and it is not happy about any of this.' },
  { type: 'sahur', name: 'Tung Tung Tung Sahur', group: 'Brainrot', when: 'Before dawn (from 03:00), anywhere',
    drops: 'Sometimes Zcash or ammo',
    desc: 'A wooden log with stick arms, a wide stare and a big wooden bat. You hear it before you see it: tung, tung, tung. It comes round in the last hours of the night to make sure you\'re up for sahur, and leaves (in flames) at sunrise.' },
  { type: 'pomodorino', name: 'Pomodorino Pugnolino', group: 'Brainrot', when: 'Night, anywhere',
    drops: 'Sometimes Zcash or ammo',
    desc: 'A ripe tomato with a leafy hat, tiny legs and a pair of boxing gloves. Bounces in fast and jabs. Sings its own name, badly.' },
  { type: 'lavatricio', name: 'Lavatricio Giraffone', group: 'Brainrot', when: 'Night, anywhere',
    drops: 'Sometimes Zcash or ammo',
    desc: 'A front-loading washing machine on four long giraffe legs, with the neck and head to match. Slow and tough, its drum always on spin, and it kicks like a mule.' },
  { type: 'ventilone', name: 'Ventilone Fenicotterone', group: 'Brainrot', when: 'Night, anywhere',
    drops: 'Sometimes Zcash or ammo',
    desc: 'A pink flamingo on one leg with an electric desk fan where its head should be. Its pecks barely hurt, but they send you flying.' },
  { type: 'cow', name: 'Cow', group: 'Animal', when: 'Day, in herds on grass',
    drops: 'Steak or liver; usually milk or cheese',
    desc: 'Grazes. Runs when hit. Provides most of the food groups, two of which some people can\'t have.' },
  { type: 'cat', name: 'Cat', group: 'Pet', when: 'Rarely, any time',
    drops: 'Nothing',
    desc: 'Comes to keep you company, at a dignified distance. Being near it makes you cough and sneeze.' },
  { type: 'dog', name: 'Dog', group: 'Pet', when: 'Rarely, any time',
    drops: 'Nothing',
    desc: 'Sticks right by your side, tail going. Also gives you allergies. Worth it.' },
  { type: 'bird', name: 'Bluebird', group: 'Bird', when: 'Day, small flocks inland',
    drops: 'Roast Bird (eat it to flap for 30 s)',
    desc: 'Blue back, orange breast, cheerful outlook. Sometimes lands to peck; takes off if you get close.' },
  { type: 'munia', name: 'Scaly-breasted Munia', group: 'Bird', when: 'Day, big flocks inland',
    drops: 'Roast Bird',
    desc: 'A small brown finch-like bird with a white breast patterned like fish scales. Travels in chattering gangs and lands often.' },
  { type: 'finch', name: 'Finch', group: 'Bird', when: 'Day, flocks inland',
    drops: 'Roast Bird',
    desc: 'Bright yellow with a black cap and barred wings. The fastest flyer around, and it knows it.' },
  { type: 'seagull', name: 'Seagull', group: 'Bird', when: 'Day, over water and beaches',
    drops: 'Roast Bird',
    desc: 'Big, loud and fearless. If you\'re holding food, it will swoop in and take it out of your hand. Then it leaves.' },
  { type: 'nutmunch', name: 'Crusty-titted Nutmunch', group: 'Bird', when: 'Day, in ones and twos inland',
    drops: 'Roast Bird',
    desc: 'Round, nut-brown and slow, with a crusty speckled chest. Spends most of its day on the ground, munching. Ornithologists disagree about the name.' },
];

/** Facts that come straight from the mob's stats, so the guide can't go out of date. */
export function bestiaryFacts(type) {
  const t = MOB_TYPES[type];
  const facts = [`${t.sized ? `${t.hp}× size` : t.hp} health`];
  if (t.passive) facts.push('harmless');
  else if (t.damage) facts.push(`hits for ${t.damage}`);
  if (t.burns) facts.push('burns in sunlight');
  const where = (t.moves || []).map((w) => MOVE_NAMES[w]).filter(Boolean);
  if (where.length) facts.push(where.join(', '));
  return facts.join(' · ');
}
