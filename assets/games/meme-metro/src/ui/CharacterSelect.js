import { CHARACTERS } from '../data/characters.js';

const fmt = (n) => Math.floor(n).toLocaleString('en-US');

// Character select screen: renders one card per roster entry with
// selected / unlocked / locked states, matching the concept-sheet layout.
export class CharacterSelect {
  constructor(storage) {
    this.storage = storage;
    this.grid = document.getElementById('char-grid');
    this.coinsEl = document.getElementById('char-coins');
    this.onSelect = null; // set by main.js; receives a character id
  }

  render() {
    this.coinsEl.textContent = fmt(this.storage.totalCoins);
    this.grid.innerHTML = '';
    for (const def of Object.values(CHARACTERS)) {
      this.grid.appendChild(this.buildCard(def));
    }
  }

  buildCard(def) {
    const unlocked = this.storage.isUnlocked(def.id);
    const selected = this.storage.selectedCharacter === def.id;

    const card = document.createElement('article');
    card.className = 'char-card'
      + (selected ? ' is-selected' : '')
      + (unlocked ? '' : ' is-locked');

    const portrait = document.createElement('div');
    portrait.className = 'char-portrait';
    portrait.textContent = unlocked ? def.emoji : '🔒';

    const name = document.createElement('h3');
    name.className = 'char-name';
    name.textContent = def.name;

    const cls = document.createElement('span');
    cls.className = 'char-class';
    cls.textContent = def.charClass;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'char-btn';
    if (selected) {
      btn.textContent = '✓ Selected';
      btn.disabled = true;
      btn.classList.add('is-selected');
    } else if (unlocked) {
      btn.textContent = 'Select';
      btn.addEventListener('click', () => {
        this.storage.selectCharacter(def.id);
        if (this.onSelect) this.onSelect(def.id);
        this.render();
      });
    } else {
      btn.textContent = `🪙 ${fmt(def.price)}`;
      btn.classList.add('is-price');
      const affordable = this.storage.totalCoins >= def.price;
      btn.disabled = !affordable;
      btn.setAttribute('aria-label', `Unlock ${def.name} for ${fmt(def.price)} Troll Coins`);
      if (affordable) {
        btn.addEventListener('click', () => {
          if (this.storage.unlockCharacter(def.id, def.price)) {
            this.storage.selectCharacter(def.id);
            if (this.onSelect) this.onSelect(def.id);
            this.render();
          }
        });
      }
    }

    card.append(portrait, name, cls, btn);
    return card;
  }
}
