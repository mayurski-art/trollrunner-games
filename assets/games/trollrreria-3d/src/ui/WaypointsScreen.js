// Fast-travel list: click a waypoint to teleport there and close the menu.
export class WaypointsScreen {
  constructor(listEl, game) {
    this.listEl = listEl;
    this.game = game;
  }

  render() {
    this.listEl.innerHTML = '';
    for (const point of this.game.waypoints()) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'tr3-waypoint-row';
      row.textContent = `📍 ${point.name}`;
      row.addEventListener('click', () => {
        this.game.travelTo(point.pos);
        this.game.closeMenus();
      });
      this.listEl.appendChild(row);
    }
  }
}
