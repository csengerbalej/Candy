import type { Session } from './Session';

export interface Award {
  title: string;
  who: string;
  detail: string;
}

/**
 * End-of-run awards (spec §31).
 *
 * The rule the spec sets, and the one worth defending: every award is
 * positive. "Legtöbb bajt okozó" is a compliment in this game. Nobody should
 * finish a co-op night being told they were the bad player — the point of the
 * scoreboard is to hand each person a story about their own night.
 */
export function awardsFor(session: Session): Award[] {
  const s = session.stats;
  const name = (i: number) => session.nameOf(i);
  const awards: Award[] = [];

  const better = (a: number, b: number): 0 | 1 => (a >= b ? 0 : 1);

  if (s.candy > 0) {
    const winner = better(s.candyByPlayer[0], s.candyByPlayer[1]);
    awards.push({
      title: 'CUKORKAKIRÁLY',
      who: name(winner),
      detail: `${s.candyByPlayer[winner]} cukorka a saját kezével`,
    });
  }

  if (s.pranks > 0) {
    const winner = better(s.pranksByPlayer[0], s.pranksByPlayer[1]);
    awards.push({
      title: 'A LEGNAGYOBB KÁOSZ',
      who: name(winner),
      detail: `${s.pranksByPlayer[winner]} csíny, mind a társáért`,
    });
  }

  if (s.catches > 0) {
    const winner = better(s.catchesByPlayer[0], s.catchesByPlayer[1]);
    awards.push({
      title: 'LEGTÖBB BAJT OKOZÓ',
      who: name(winner),
      detail: `${s.catchesByPlayer[winner]}× bukott le — és mindig visszament`,
    });
  } else if (s.housesVisited > 0) {
    awards.push({
      title: 'ÁRNYÉKOK',
      who: `${name(0)} és ${name(1)}`,
      detail: 'egyszer sem buktatok le — ez gyanús',
    });
  }

  if (s.nearMisses > 0) {
    awards.push({
      title: 'MAJDNEM ELÜTÖTTÜK',
      who: `${name(0)} és ${name(1)}`,
      detail: `${s.nearMisses} szörny úszta meg hajszál híján`,
    });
  }

  if (s.crittersHit === 0 && s.housesVisited > 0) {
    awards.push({
      title: 'A SZÖRNYEK BARÁTJA',
      who: `${name(0)} és ${name(1)}`,
      detail: 'egyetlen kis szörny sem sérült meg',
    });
  } else if (s.crittersHit > 0) {
    awards.push({
      title: 'BOCSÁNAT, KIS HAVER',
      who: session.nameOf(session.driverIndex),
      detail: `${s.crittersHit} szörny repült — mind túlélte`,
    });
  }

  const driver = better(s.secondsDriving[0], s.secondsDriving[1]);
  awards.push({
    title: 'LEGJOBB SOFŐR',
    who: name(driver),
    detail: `${Math.round(s.secondsDriving[driver])} másodperc a volánnál, ${s.crashes} koccanással`,
  });

  awards.push({
    title: 'LEGJOBB NAVIGÁTOR',
    who: name(driver === 0 ? 1 : 0),
    detail: 'ő tudta, merre van a ház — és szólt is',
  });

  return awards;
}
