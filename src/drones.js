// Delivery drones for CONSUME orders: when an order is ready, a drone flies in from far away,
// hovers over its customer, hands the package down, and flies off again. No Three.js, no DOM.
import { T, tune, bindTunable } from './tuning.js';

// Server settings (tuning.js): read the live values as T.key.
tune('Economy', {
  droneSpeed: [14, 'Drone speed', 'Delivery drone blocks per second', { min: 1 }],
  droneDistance: [45, 'Drone start distance', 'How far away delivery drones set off from'],
  droneHeight: [28, 'Drone start height', 'How high delivery drones set off from'],
  droneHover: [2.8, 'Drone hover height', 'How far above you a drone hands over the package'],
  droneLeave: [6, 'Drone exit time', 'Seconds a drone flies off before vanishing', { unit: ' s' }],
});


export class Drones {
  constructor(rand = Math.random) {
    this.rand = rand;
    this.list = [];
    this.nextId = 1;
  }

  /** Sends a drone carrying `kind` to `owner` (a player id), who is at `at`. Returns the drone. */
  launch(owner, kind, at) {
    const a = this.rand() * Math.PI * 2;
    const drone = {
      id: this.nextId++, owner, kind, carrying: true, leaving: false, t: 0, yaw: 0,
      pos: { x: at.x + Math.cos(a) * T.droneDistance, y: at.y + T.droneHeight, z: at.z + Math.sin(a) * T.droneDistance },
    };
    this.list.push(drone);
    return drone;
  }

  /**
   * Moves the drones. `targetOf(drone)` gives where its customer is now (feet), or null if they're
   * dead (it waits) or `false` if they've gone (it turns back with the package). Returns
   * [{ type: 'deliver', drone }] for drones that just reached their customer.
   */
  update(dt, targetOf) {
    const events = [];
    for (const d of this.list) {
      d.t += dt;
      if (d.leaving) { // up and away
        d.pos.y += T.droneSpeed * 0.5 * dt;
        d.pos.x += -Math.sin(d.yaw) * T.droneSpeed * dt;
        d.pos.z += -Math.cos(d.yaw) * T.droneSpeed * dt;
        continue;
      }
      const target = targetOf(d);
      if (target === false) { this._leave(d); continue; }
      if (!target) continue; // hover and wait (the customer is respawning)
      const dx = target.x - d.pos.x;
      const dy = target.y + T.droneHover - d.pos.y;
      const dz = target.z - d.pos.z;
      const dist = Math.hypot(dx, dy, dz);
      if (Math.hypot(dx, dz) > 0.5) d.yaw = Math.atan2(-dx, -dz); // models face -Z
      if (dist < 0.6) {
        events.push({ type: 'deliver', drone: d });
        d.carrying = false;
        this._leave(d);
        continue;
      }
      const step = Math.min(dist, T.droneSpeed * dt * (dist < 6 ? 0.5 : 1)); // slow down for the drop
      d.pos.x += (dx / dist) * step;
      d.pos.y += (dy / dist) * step;
      d.pos.z += (dz / dist) * step;
    }
    this.list = this.list.filter((d) => !(d.leaving && d.t > T.droneLeave));
    return events;
  }

  _leave(d) {
    d.leaving = true;
    d.t = 0;
  }
}
