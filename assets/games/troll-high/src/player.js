/* Troll High — the player avatar: movement, collision, facing. */

import { TILE, dirFromVector } from "./util.js";

const SPEED = 76;          // px/s — GBA walk pace
const FEET_W = 10, FEET_H = 6; // collision box (feet), centered on x

export class Player {
  constructor(sprites) {
    this.sprites = sprites;
    this.x = 0; this.y = 0;   // feet center, world px
    this.dir = "south";
    this.moving = false;
    this.animT = 0;
  }

  placeAtTile(tx, ty) {
    this.x = (tx + 0.5) * TILE;
    this.y = (ty + 1) * TILE - 2;
  }

  get tileX() { return Math.floor(this.x / TILE); }
  get tileY() { return Math.floor((this.y - 2) / TILE); }

  /* Tile directly in front of the player (for interactions). */
  facingTile() {
    const o = {
      east: [1, 0], "south-east": [1, 1], south: [0, 1], "south-west": [-1, 1],
      west: [-1, 0], "north-west": [-1, -1], north: [0, -1], "north-east": [1, -1],
    }[this.dir];
    return { x: this.tileX + o[0], y: this.tileY + o[1] };
  }

  update(dt, axis, zone) {
    const moving = axis.x !== 0 || axis.y !== 0;
    this.moving = moving;
    if (moving) {
      this.dir = dirFromVector(axis.x, axis.y);
      this.animT += dt;
      // per-axis moves so we slide along walls
      this._move(axis.x * SPEED * dt, 0, zone);
      this._move(0, axis.y * SPEED * dt, zone);
    } else {
      this.animT = 0;
    }
  }

  _move(dx, dy, zone) {
    const nx = this.x + dx, ny = this.y + dy;
    const hw = FEET_W / 2;
    const corners = [
      [nx - hw, ny - FEET_H], [nx + hw, ny - FEET_H],
      [nx - hw, ny], [nx + hw, ny],
    ];
    if (!corners.some(([px, py]) => zone.solidAt(px, py))) {
      this.x = nx; this.y = ny;
    }
  }

  entity() {
    return {
      y: this.y,
      draw: ctx => this.sprites.draw(ctx, this.dir, this.moving, this.animT, this.x, this.y),
    };
  }
}
