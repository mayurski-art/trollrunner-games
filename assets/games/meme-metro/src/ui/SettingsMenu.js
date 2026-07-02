// Settings screen: toggles + graphics quality, persisted via StorageManager.
// Quality changes call back into Game so the renderer rescales immediately.

const TOGGLES = [
  { key: 'music', label: 'Music' },
  { key: 'sfx', label: 'Sound Effects' },
  { key: 'cameraShake', label: 'Camera Shake' },
  { key: 'controlHints', label: 'Control Hints' },
];
const QUALITIES = ['low', 'medium', 'high'];

export class SettingsMenu {
  constructor(storage) {
    this.storage = storage;
    this.list = document.getElementById('settings-list');
    this.onQualityChange = null; // set by main.js
  }

  render() {
    this.list.innerHTML = '';
    for (const t of TOGGLES) {
      this.list.appendChild(this.buildToggle(t));
    }
    this.list.appendChild(this.buildQuality());
  }

  buildToggle({ key, label }) {
    const row = document.createElement('div');
    row.className = 'settings-row';
    const name = document.createElement('span');
    name.textContent = label;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'settings-toggle';
    btn.setAttribute('role', 'switch');
    const sync = () => {
      const on = this.storage.settings[key];
      btn.textContent = on ? 'ON' : 'OFF';
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-checked', String(on));
      btn.setAttribute('aria-label', `${label} ${on ? 'on' : 'off'}`);
    };
    btn.addEventListener('click', () => {
      this.storage.settings[key] = !this.storage.settings[key];
      this.storage.save();
      sync();
    });
    sync();
    row.append(name, btn);
    return row;
  }

  buildQuality() {
    const row = document.createElement('div');
    row.className = 'settings-row';
    const name = document.createElement('span');
    name.textContent = 'Graphics Quality';
    const group = document.createElement('div');
    group.className = 'settings-quality';
    const sync = () => {
      for (const b of group.children) {
        b.classList.toggle('is-on', b.dataset.q === this.storage.settings.quality);
      }
    };
    for (const q of QUALITIES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.q = q;
      btn.textContent = q[0].toUpperCase() + q.slice(1);
      btn.addEventListener('click', () => {
        this.storage.settings.quality = q;
        this.storage.save();
        if (this.onQualityChange) this.onQualityChange(q);
        sync();
      });
      group.appendChild(btn);
    }
    sync();
    row.append(name, group);
    return row;
  }
}
