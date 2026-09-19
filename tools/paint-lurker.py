"""
A SZÖRNYEK FESTÉSE — CSONTSÚLY ALAPJÁN, NEM TALÁLGATÁSBÓL.

A letöltött modelleken nincs színtextúra (mérve: a Fuldokló Őrnél csak
normálmap van, a másik kettőn semmi), és UV sincs — tehát képet nem lehet
rájuk feszíteni. Marad a csúcsszín.

Az eddigi festés egyetlen szürke színt kent az egész testre, magasság
szerint halványítva. Ettől lett a szörny agyagszobor: a kabát, a kéz és az
arc ugyanaz a szín volt.

A modellben viszont OTT VAN, melyik csúcs mi: minden csúcshoz tartozik
csontsúly (JOINTS_0 / WEIGHTS_0), a csontoknak pedig nevük van
(mixamorig:LeftHand, mixamorig:RightToeBase, mixamorig:Head…). A domináns
csontból tehát PONTOSAN tudjuk, hogy kézről, lábfejről, fejről vagy
törzsről van szó — nincs benne becslés.

  python3 tools/paint-lurker.py public/models/lurker-koveto.json warden
"""
import json, base64, struct, sys, math

BOR = 'bor'      # kéz, lábfej, arc
RUHA = 'ruha'    # minden más

PALETTAK = {
    # A referencia: sötét, kékesszürke csuha, csepegő nedvességgel, és
    # halvány, hideg bőr a kézen, lábon, arcon.
    'warden': {RUHA: (0.085, 0.085, 0.115), BOR: (0.34, 0.37, 0.43)},
    # A Vak: viaszos, beteges, szürkés — a bőr nála majdnem az egész test.
    'vak':    {RUHA: (0.12, 0.125, 0.115), BOR: (0.30, 0.31, 0.28)},
    # A pók-ghoul: hidegebb, zöldes-fekete.
    'ghoul':  {RUHA: (0.075, 0.095, 0.085), BOR: (0.26, 0.30, 0.27)},
}

BOR_CSONTOK = ('Hand', 'Toe', 'Foot', 'Head')


def glb_reszek(nyers: bytes):
    hossz = struct.unpack('<I', nyers[12:16])[0]
    fej = json.loads(nyers[20:20 + hossz])
    bin_eleje = 20 + hossz + 8
    return fej, bin_eleje


def nezet(fej, bin_eleje, nyers, accessor_index):
    acc = fej['accessors'][accessor_index]
    bv = fej['bufferViews'][acc['bufferView']]
    eltolas = bin_eleje + bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
    return acc, bv, eltolas


TIPUS = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
ELEM = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def olvas(fej, bin_eleje, nyers, idx):
    acc, bv, eltolas = nezet(fej, bin_eleje, nyers, idx)
    kod, meret = TIPUS[acc['componentType']]
    n = ELEM[acc['type']]
    lepes = bv.get('byteStride') or meret * n
    ki = []
    for i in range(acc['count']):
        alap = eltolas + i * lepes
        ki.append(struct.unpack_from('<' + kod * n, nyers, alap))
    return ki


def fest(utvonal: str, paletta_nev: str) -> None:
    doboz = json.load(open(utvonal))
    nyers = bytearray(base64.b64decode(doboz['glb']))
    fej, bin_eleje = glb_reszek(nyers)

    csontnevek = [fej['nodes'][i].get('name', '') for i in fej['skins'][0]['joints']]
    paletta = PALETTAK[paletta_nev]

    for mesh in fej['meshes']:
        for prim in mesh['primitives']:
            a = prim['attributes']
            if 'COLOR_0' not in a or 'JOINTS_0' not in a:
                continue
            poz = olvas(fej, bin_eleje, nyers, a['POSITION'])
            izom = olvas(fej, bin_eleje, nyers, a['JOINTS_0'])
            suly = olvas(fej, bin_eleje, nyers, a['WEIGHTS_0'])
            nor = olvas(fej, bin_eleje, nyers, a['NORMAL'])

            lo = min(p[1] for p in poz)
            hi = max(p[1] for p in poz)
            magassag = max(1e-6, hi - lo)

            acc, bv, eltolas = nezet(fej, bin_eleje, nyers, a['COLOR_0'])
            lepes = bv.get('byteStride') or 12

            bor_db = 0
            for i in range(acc['count']):
                # A DOMINÁNS CSONT: a legnagyobb súlyú. Nem átlagolunk —
                # egy ujjhegy vagy kéz, vagy nem az.
                j = izom[i]
                w = suly[i]
                legjobb = max(range(len(w)), key=lambda k: w[k])
                nev = csontnevek[j[legjobb]] if j[legjobb] < len(csontnevek) else ''
                bor = any(k in nev for k in BOR_CSONTOK)
                if bor:
                    bor_db += 1
                c = list(paletta[BOR if bor else RUHA])

                t = (poz[i][1] - lo) / magassag
                # LENT SÖTÉTEBB: a szegély és a láb környéke elnyeli a fényt.
                also = 0.55 + 0.45 * min(1.0, t * 1.6)
                # CSEPEGÉS: függőleges csíkok, a kabáton erősen, a bőrön alig.
                csik = 0.5 + 0.5 * math.sin(poz[i][0] * 140.0 + poz[i][2] * 90.0)
                csepp = 1.0 - (0.0 if bor else 0.38) * csik * min(1.0, t * 1.3)
                # A LEFELÉ NÉZŐ LAPOK tompábbak — enélkül a forma lapos.
                lap = 0.6 + 0.4 * max(0.0, nor[i][1] * 0.5 + 0.5)
                for k in range(3):
                    c[k] = c[k] * also * csepp * lap
                struct.pack_into('<3f', nyers, eltolas + i * lepes, *c)

            print(f'  {acc["count"]} csúcs, ebből bőr: {bor_db} ({bor_db * 100 // acc["count"]}%)')

    doboz['glb'] = base64.b64encode(bytes(nyers)).decode()
    json.dump(doboz, open(utvonal, 'w'))
    print(f'  kész: {utvonal}')


if __name__ == '__main__':
    fest(sys.argv[1], sys.argv[2])
