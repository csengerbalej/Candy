import type { RoomTransport } from './Room';
import type { NetSession } from './NetSession';
import { CHARACTER_ORDER, type Selection } from '../game/Characters';

/**
 * Ki a társam, és minek öltözött.
 *
 * Amíg egy gépen ült két ember, ez fel sem merült: egy front-end kérdezte meg
 * mindkettőt. Két eszközön viszont mindenki a SAJÁT gépén választ nevet és
 * szörnyet, tehát a másik választása adat, ami átjön — enélkül mindkét
 * képernyőn az alapértelmezett második szörny szaladgálna, más néven, mint
 * amit a társ magának választott.
 *
 * Presence-szel megy, nem eseménnyel, és ez a lényeg: aki később lép be — vagy
 * újratölti az oldalt a ház közepén — az AZONNAL megkapja, mert a jelenlét
 * állapot. Egy induláskor egyszer elküldött esemény pont neki veszne el.
 */
export class Identity {
  constructor(
    private readonly room: RoomTransport | null,
    private readonly session: NetSession
  ) {}

  /** A legutóbb kitett saját azonosság. Csak változáskor küldünk újat. */
  private utoljara = '';

  /**
   * Kiteszi a sajátunkat, és beolvassa a társét a kiválasztásba.
   *
   * A kiválasztás egy tömb, aminek a helyei rögzítettek: a 0. a gazdáé, az 1.
   * a vendégé. Mindenki csak a SAJÁT helyét írja — se a játék, se a HUD nem
   * tudná eldönteni, melyik írásnak higgyen, ha mindkét gép mindkettőt írná.
   */
  sync(selection: Selection): void {
    const state = this.session.current;
    if (!this.room || !state.paired) return;
    const mine = state.playerIndex;
    const theirs = mine === 0 ? 1 : 0;

    // CSAK VÁLTOZÁSKOR KÜLDÜNK.
    //
    // Ez képkockánként fut, tehát másodpercenként hatvanszor tette ki
    // ugyanazt a nevet. Nem csak pazarlás: minden kitétel értesíti a
    // jelenlét figyelőit, és egy hatvan hertzes értesítés-áradat a
    // leglassabb eszközt éri el először — pont a telefont.
    const jel = `${mine}|${selection.names[mine]}|${selection.characters[mine]}`;
    if (jel !== this.utoljara) {
      this.utoljara = jel;
      this.room.presence({
        idn: selection.names[mine],
        idc: selection.characters[mine],
        idi: mine,
      });
    }

    for (const peer of this.room.peers()) {
      if (peer.isMe) continue;
      const p = peer.presence as { idn?: unknown; idc?: unknown; idi?: unknown };
      if (p.idi !== theirs) continue;
      if (typeof p.idn === 'string' && p.idn) selection.names[theirs] = p.idn;
      // Csak ismert karaktert fogadunk el: a szoba tartalma más nézőktől jön,
      // tehát bemenet, nem parancs — egy ismeretlen azonosító a modellbetöltőt
      // dobná el egy olyan névvel, amit nem mi találtunk ki.
      if (typeof p.idc === 'string' && (CHARACTER_ORDER as readonly string[]).includes(p.idc)) {
        selection.characters[theirs] = p.idc as Selection['characters'][number];
      }
    }
  }
}
