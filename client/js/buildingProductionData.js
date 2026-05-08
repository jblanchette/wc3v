/**
 * Static mapping of building itemIds to what they produce, research, or sell.
 * Used by BuildingInfoTooltip to show contextual building information on hover.
 */
const BUILDING_PRODUCTION = {
  // ─── Human ────────────────────────────────────────────────────────
  'htow': { type: 'production', label: 'Town Hall', units: ['hpea'], upgrades: ['Rhpm'] },
  'hkee': { type: 'production', label: 'Keep', units: ['hpea'], upgrades: ['Rhpm'] },
  'hcas': { type: 'production', label: 'Castle', units: ['hpea'], upgrades: ['Rhpm'] },
  'halt': { type: 'altar', label: 'Altar of Kings', units: ['Hpal', 'Hamg', 'Hmkg', 'Hblm'] },
  'hbar': { type: 'production', label: 'Barracks', units: ['hfoo', 'hrif', 'hkni', 'hmtm'] },
  'hars': { type: 'production', label: 'Arcane Sanctum', units: ['hmpr', 'hsor', 'hspt'] },
  'harm': { type: 'production', label: 'Workshop', units: ['hgyr', 'hmtt'] },
  'hgra': { type: 'production', label: 'Aviary', units: ['hgry', 'hdhw'] },
  'hbla': { type: 'research', label: 'Blacksmith', upgrades: ['Rhme', 'Rhra', 'Rhar', 'Rhla'] },
  'hlum': { type: 'research', label: 'Lumber Mill', upgrades: ['Rhlh', 'Rhac'] },
  'hvlt': { type: 'shop', label: 'Arcane Vault', items: ['phea', 'pman', 'pinv', 'stwp', 'dust', 'plcl'] },
  'hhou': { type: 'supply', label: 'Farm' },
  'hatw': { type: 'tower', label: 'Arcane Tower' },
  'hgtw': { type: 'tower', label: 'Guard Tower' },
  'hctw': { type: 'tower', label: 'Cannon Tower' },

  // ─── Orc ──────────────────────────────────────────────────────────
  'ogre': { type: 'production', label: 'Great Hall', units: ['opeo'], upgrades: ['Ropm'] },
  'ostr': { type: 'production', label: 'Stronghold', units: ['opeo'], upgrades: ['Ropm'] },
  'ofrt': { type: 'production', label: 'Fortress', units: ['opeo'], upgrades: ['Ropm'] },
  'oalt': { type: 'altar', label: 'Altar of Storms', units: ['Obla', 'Ofar', 'Otch', 'Oshd'] },
  'obar': { type: 'production', label: 'Barracks', units: ['ogru', 'ohun', 'ocat', 'orai'] },
  'obea': { type: 'production', label: 'Beastiary', units: ['orai', 'okod', 'owyr', 'owyv'] },
  'oshy': { type: 'production', label: 'Spirit Lodge', units: ['oshm', 'odoc', 'ospw'] },
  'otto': { type: 'production', label: 'Tauren Totem', units: ['otau', 'ospw'] },
  'ofor': { type: 'research', label: 'War Mill', upgrades: ['Rome', 'Rora', 'Roar', 'Robs'] },
  'ovln': { type: 'shop', label: 'Voodoo Lounge', items: ['phea', 'pman', 'pinv', 'stwp', 'tpow'] },
  'otrb': { type: 'supply', label: 'Orc Burrow' },
  'owtw': { type: 'tower', label: 'Watch Tower' },
  'osld': { type: 'research', label: 'Spirit Lodge' },

  // ─── Night Elf ────────────────────────────────────────────────────
  'etol': { type: 'production', label: 'Tree of Life', units: ['ewsp'], upgrades: ['Renb'] },
  'etoa': { type: 'production', label: 'Tree of Ages', units: ['ewsp'], upgrades: ['Renb'] },
  'etoe': { type: 'production', label: 'Tree of Eternity', units: ['ewsp'], upgrades: ['Renb'] },
  'eate': { type: 'altar', label: 'Altar of Elders', units: ['Edem', 'Ekee', 'Emoo', 'Ewar'] },
  // WC3 ancients: eaom=War (T1), eaoe=Lore (T2), eaow=Wind (T2). The labels
  // and unit rosters were previously scrambled — Ancient of War (eaom) was
  // showing up labeled "Ancient of Wind" in the build order, which made any
  // Tier 1 NE replay look like it had a Tier-2 building in Tier 1.
  'eaom': { type: 'production', label: 'Ancient of War', units: ['earc', 'esen', 'ebal'] },
  'eaoe': { type: 'production', label: 'Ancient of Lore', units: ['edoc', 'edry', 'emtg'] },
  'eaow': { type: 'production', label: 'Ancient of Wind', units: ['edot', 'efdr', 'ehip'] },
  'edob': { type: 'production', label: 'Hunter\'s Hall', upgrades: ['Reib', 'Rema', 'Rerh'] },
  'eden': { type: 'production', label: 'Ancient of Wonders', items: ['phea', 'pman', 'pinv', 'stwp', 'dust', 'moon'] },
  'emow': { type: 'supply', label: 'Moon Well' },
  'etrp': { type: 'tower', label: 'Ancient Protector' },

  // ─── Undead ───────────────────────────────────────────────────────
  'unpl': { type: 'production', label: 'Necropolis', units: ['uaco'] },
  'unp1': { type: 'production', label: 'Halls of the Dead', units: ['uaco'] },
  'unp2': { type: 'production', label: 'Black Citadel', units: ['uaco'] },
  'uaod': { type: 'altar', label: 'Altar of Darkness', units: ['Udea', 'Udre', 'Ulic', 'Ucry'] },
  'ubar': { type: 'production', label: 'Crypt', units: ['ugho', 'ugar', 'ucry'] },
  'usep': { type: 'production', label: 'Temple of the Damned', units: ['unec', 'uban', 'uobs'] },
  'uslh': { type: 'production', label: 'Slaughterhouse', units: ['uabo', 'umtw', 'uobs'] },
  'ugrv': { type: 'production', label: 'Graveyard', upgrades: ['Rume', 'Rura', 'Ruar', 'Rucr'] },
  'utod': { type: 'research', label: 'Tomb of Relics', items: ['phea', 'pman', 'pinv', 'stwp', 'dust', 'ritd'] },
  'uzig': { type: 'supply', label: 'Ziggurat' },
  'uzg1': { type: 'tower', label: 'Spirit Tower' },
  'uzg2': { type: 'tower', label: 'Nerubian Tower' },
  'utom': { type: 'research', label: 'Sacrificial Pit' },
  'ubon': { type: 'research', label: 'Boneyard', units: ['ufro'] },
  'ugol': { type: 'production', label: 'Haunted Gold Mine', units: ['uaco'] },

  // ─── Neutral ──────────────────────────────────────────────────────
  'ngol': { type: 'goldmine', label: 'Gold Mine' },
  'nfoh': { type: 'fountain', label: 'Fountain of Health' },
  'nmoo': { type: 'fountain', label: 'Fountain of Mana' },
  'ntav': { type: 'shop', label: 'Tavern' },
  'ngme': { type: 'shop', label: 'Goblin Merchant' },
  'nmer': { type: 'shop', label: 'Marketplace' },
  'nmrk': { type: 'shop', label: 'Goblin Laboratory' }
};

window.BUILDING_PRODUCTION = BUILDING_PRODUCTION;
