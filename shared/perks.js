// Ventajas (Perk-a-Colas). Todas requieren electricidad.

export const PERK_LIMIT = 4; // como en BO2

export const PERKS = {
  quickrevive: {
    key: 'quickrevive', name: 'Quick Revive', price: 1500, soloPrice: 500,
    color: '#3fa9f5', glow: 0x3fa9f5, icon: 'QR',
    desc: 'Reanimas el doble de rápido. En solitario: te reanimas solo (3 usos).',
  },
  juggernog: {
    key: 'juggernog', name: 'Juggernog', price: 2500,
    color: '#e0282e', glow: 0xff2a2a, icon: 'JG',
    desc: 'Aumenta tu salud: aguantas 5 golpes en vez de 2.',
  },
  speedcola: {
    key: 'speedcola', name: 'Speed Cola', price: 3000,
    color: '#2dc653', glow: 0x39ff6a, icon: 'SC',
    desc: 'Recargas y reconstruyes barricadas el doble de rápido.',
  },
  doubletap: {
    key: 'doubletap', name: 'Double Tap Root Beer', price: 2000,
    color: '#f7b32b', glow: 0xffc23a, icon: 'DT',
    desc: 'Disparas un 33% más rápido y cada bala hace el doble de daño.',
  },
  staminup: {
    key: 'staminup', name: 'Stamin-Up', price: 2000,
    color: '#f08c2e', glow: 0xffa040, icon: 'SU',
    desc: 'Corres más rápido y durante el doble de tiempo.',
  },
  mulekick: {
    key: 'mulekick', name: 'Mule Kick', price: 4000,
    color: '#6fa83a', glow: 0x8fe04a, icon: 'MK',
    desc: 'Puedes llevar una tercera arma.',
  },
};

export const PERK_KEYS = Object.keys(PERKS);

export function perkPrice(key, playerCount) {
  const p = PERKS[key];
  if (!p) return 0;
  if (key === 'quickrevive' && playerCount <= 1) return p.soloPrice;
  return p.price;
}
