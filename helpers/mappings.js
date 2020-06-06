const w3gMappings = require("../node_modules/w3gjs/dist/lib/mappings");

let {
	units,
    buildings,
    items,
    abilityToHero
} = w3gMappings;

const extraUnits = {
	'AOsf': 'Feral Spirit',
	'uske': 'Skeleton Warrior',
    'ucs1': 'Carrion Beetle (lvl 1)',
    'ucs2': 'Carrion Beetle (lvl 2)',
    'ucs3': 'Carrion Beetle (lvl 3)',
    'ucs4': 'Carrion Beetle (lvl 4)',
    'osw1': 'Spirit Wolf (lvl 1)',
    'osw2': 'Spirit Wolf (lvl 2)',
    'osw3': 'Spirit Wolf (lvl 3)',
    'hwat': 'Elemental (lvl 1)',
    'hwt2': 'Elemental (lvl 2)',
    'hwt3': 'Elemental (lvl 3)',
    'efon': 'Treant'
};

const extraItems = {
    'Jwid': 'Unknown Item'
};

Object.keys(extraUnits).forEach(key => {
	units[key] = extraUnits[key];
});

Object.keys(extraItems).forEach(key => {
    items[key] = extraItems[key];
});

const workerForRace = {
    'O': 'opeo',
    'U': 'uaco',
    'E': 'ewsp',
    'H': 'hpea'
};

const unitMetaData = {
    'uobs': {
        'displayName': 'Obsidian Statue',
        'hero': false,
        'worker': true,
        'permanent': true,
        'playerShop': false,
        'race': 'H',
        'movespeed': 190,
        'evolution': {
            'itemId': 'ubsp',
            'time': 45
        } 
    },
	'opeo': {
		'displayName': 'Peon',
		'hero': false,
		'worker': true,
		'permanent': true,
        'playerShop': false,
        'race': 'O',
        'movespeed': 190
	},
	'uaco': {
		'displayName': 'Acolyte',
		'hero': false,
		'worker': true,
		'permanent': true,
        'playerShop': false,
        'race': 'U',
        'movespeed': 235
	},
	'ewsp': {
		'displayName': 'Wisp',
		'hero': false,
		'worker': true,
		'permanent': true,
        'playerShop': false,
        'race': 'E',
        'movespeed': 270
	},
	'hpea': {
		'displayName': 'Peasent',
		'hero': false,
		'worker': true,
		'permanent': true,
        'playerShop': false,
        'race': 'H',
        'movespeed': 190,
        'evolution': {
            'itemId': 'hmil',
            'time': 45
        }
	},
    'hmil': {
        'displayName': 'Militia',
        'hero': false,
        'worker': true,
        'permanent': true,
        'playerShop': false,
        'race': 'H',
        'movespeed': 190
    },
	'Hamg': {
		'displayName': 'Archmage',
		'hero': true,
		'worker': false,
		'permanent': true,
        'playerShop': false
	},
  'Hblm': {
		'displayName': 'Blood Mage',
		'hero': true,
		'worker': false,
		'permanent': true,
        'playerShop': false
	},
  'Hmkg': {
		'displayName':'Mountain King',
		'hero': true,
		'worker': false,
		'permanent': true,
        'playerShop': false
	},
  'Hpal': {
		'displayName':'Paladin',
		'hero': true,
		'worker': false,
		'permanent': true
	},
  'Ewar': {
		'displayName':'Warden',
		'hero': true,
		'worker': false,
		'permanent': true,
        'playerShop': false
	},
  'Ekee': {
		'displayName':'Keeper of the Grove',
		'hero': true,
		'worker': false,
		'permanent': true,
        'playerShop': false
	},
  'Emoo': {
		'displayName':'Priestess of the Moon',
		'hero': true,
		'worker': false,
		'permanent': true,
        'playerShop': false
	},
  'Edem': {
		'displayName':'Demon Hunter',
		'hero': true,
		'worker': false,
		'permanent': true,
        'playerShop': false
	},
  'Oshd': {
		'displayName':'Shadow Hunter',
		'hero': true,
		'worker': false,
		'permanent': true,
        'playerShop': false
	},
  'Obla': {
		'displayName':'Blademaster',
		'hero': true,
		'worker': false,
		'permanent': true,
        'playerShop': false
	},
  'Ofar': {
		'displayName':'Far Seer',
		'hero': true,
		'worker': false,
		'permanent': true,
        'playerShop': false
  },
  'Otch': {
		'displayName':'Tauren Chieftain',
		'hero': true,
		'worker': false,
		'permanent': true,
        'playerShop': false
  },
  'Ucrl': {
		'displayName':'Crypt Lord',
		'hero': true,
		'worker': false,
		'permanent': true,
        'playerShop': false
  },
  'Udea': {
		'displayName':'Death Knight',
		'hero': true,
		'worker': false,
		'permanent': true,
        'playerShop': false,
        'movespeed': 300
  },
  'Udre': {
		'displayName':'Dread Lord',
		'hero': true,
		'worker': false,
		'permanent': true,
        'playerShop': false
  },
  'Ulic': {
		'displayName':'Lich',
		'hero': true,
		'worker': false,
		'permanent': true,
        'playerShop': false
  },
  'Npbm': {
		'displayName':'Pandaren Brewmaster',
		'hero': true,
		'worker': false,
		'permanent': true,
        'playerShop': false
  },
  'Nbrn': {
		'displayName':'Dark Ranger',
		'hero': true,
		'worker': false,
		'permanent': true,
        'playerShop': false
  },
  'Nngs': {
		'displayName':'Naga Sea Witch',
		'hero': true,
		'worker': false,
		'permanent': true,
        'playerShop': false
  },
  'Nplh': {
		'displayName':'Pit Lord',
		'hero': true,
		'worker': false,
		'permanent': true,
        'playerShop': false
  },
  'Nbst': {
		'displayName':'Beastmaster',
		'hero': true,
		'worker': false,
		'permanent': true,
        'playerShop': false
  },
  'Ntin': {
		'displayName':'Goblin Tinker',
		'hero': true,
		'worker': false,
		'permanent': true,
        'playerShop': false
  },
  'Nfir': {
		'displayName':'FireLord',
		'hero': true,
		'worker': false,
		'permanent': true,
        'playerShop': false
  },
  'Nalc': {
		'displayName':'Goblin Alchemist',
		'hero': true,
		'worker': false,
		'permanent': true,
        'playerShop': false
  }
};

const allItemIds = {
    'AEah': 'Thorns Aura',
    'AEar': 'Trueshot',
    'AEbl': 'Blink',
    'AEer': 'Entangling Roots',
    'AEev': 'Evasion',
    'AEfk': 'Fan of Knives',
    'AEfn': 'Force of Nature',
    'AEim': 'Immolation',
    'AEm': 'Mana Burn',
    'AEme': 'Metamorphosis',
    'AEsf': 'Starfall',
    'AEsh': 'Shadow Strike',
    'AEst': 'Scout',
    'AEsv': 'Vengence',
    'AEtq': 'Tranquility',
    'AHa': 'Brilliance Aura',
    'AHad': 'Devotion Aura',
    'AHav': 'Avatar',
    'AHbh': 'Bash',
    'AHbn': 'Banish',
    'AHbz': 'Blizzard',
    'AHdr': 'Siphon Mana',
    'AHds': 'Divine Shield',
    'AHfa': 'Searing Arrows',
    'AHfs': 'Flame Strike',
    'AHh': 'Holy Bolt',
    'AHmt': 'Mass Teleport',
    'AHpx': 'Summon Phoenix',
    'AHre': 'Resurrection',
    'AHt': 'Storm Bolt',
    'AHtc': 'Thunder Clap',
    'AHwe': 'Summon Water Elemental',
    'AOae': 'Endurance Aura',
    'AOcl': 'Chain Lightning',
    'AOcr': 'Critical Strike',
    'AOeq': 'Earthquake',
    'AOfs': 'Far Sight',
    'AOhw': 'Healing Wave',
    'AOhx': 'Hex',
    'AOmi': 'Mirror Image',
    'AOre': 'Reincarnation',
    'AOsf': 'Feral Spirit',
    'AOsh': 'Shockwave',
    'AOsw': 'Serpent Ward',
    'AOvd': 'Big Bad Voodoo',
    'AOwk': 'Wind Walk',
    'AOws': 'War Stomp',
    'AOww': 'Blade Storm',
    'AUan': 'Animate Dead',
    'AUau': 'Unholy Aura',
    'AUav': 'Vampiric Aura',
    'ucs1': 'Carrion Beetles',
    'AUcs': 'Carrion Swarm',
    'AUdc': 'Death Coil',
    'AUdd': 'Death and Decay',
    'AUdp': 'Death Pact',
    'AUdr': 'Dark Ritual',
    'AUfn': 'Frost Nova',
    'AUfu': 'Frost Armor',
    'AUim': 'Impale',
    'AUin': 'Inferno',
    'AUls': 'Locust Swarm',
    'AUsl': 'Sleep',
    'AUts': 'Spiked Carapace',
    'eaoe': 'Ancient of Lore',
    'eaom': 'Ancient of War',
    'eaow': 'Ancient of Wind',
    'earc': 'Archer',
    'eate': 'Altar of Elders',
    'ebal': 'Ballista',
    'Ecen': 'Cenarius',
    'echm': 'Chimeara',
    'edcm': 'Druid of the Claw (Metamophed)',
    'Edem': 'Demon Hunter',
    'eden': 'Ancient of Wonders',
    'Edmm': 'Demon Hunter (Metamophed)',
    'edo': 'Hunter\'s Hall',
    'edoc': 'Druid of the Claw',
    'edol': 'Bear Den',
    'edos': 'Chimaera Roost',
    'edot': 'Druid of the Talon',
    'edry': 'Dryad',
    'edtm': 'Druid of the Talon (Metamophed)',
    'Eevi': 'Illidan',
    'Eevm': 'Illidan Demon',
    'efdr': 'Faerie Dragon',
    'efon': 'Ent',
    'egol': 'Entangled Gold Mine',
    'ehip': 'Hippogryph',
    'ehpr': 'Hippogryph Rider',
    'Ekee': 'Keeper of the Grove',
    'Emoo': 'Priestess of the Moon',
    'emow': 'Moon Well',
    'emtg': 'Mountain Giant',
    'esen': 'Huntress',
    'eshd': 'Shandris',
    'etoa': 'Tree of Ages',
    'etoe': 'Tree of Eternity',
    'etol': 'Tree of Life',
    'etrp': 'Ancient Protector',
    'Ewar': 'Warden',
    'Ewrd': 'Maiev',
    'ewsp': 'Wisp',
    'halt': 'Altar of Kings',
    'Hamg': 'Archmage',
    'harm': 'Workshop',
    'hars': 'Arcane Sanctum',
    'hatw': 'Arcane Tower',
    'hbar': 'Barracks',
    'hbep': 'Blood Elf Priest',
    'hbes': 'Blood Elf Sorceress',
    'hbla': 'Blacksmith',
    'Hblm': 'Blood Mage',
    'hcas': 'Castle',
    'hcth': 'High Elf Footman',
    'hctw': 'Cannon Tower',
    'hdhw': 'Dragonhawk Rider',
    'hfoo': 'Footman',
    'hgra': 'Aviary',
    'hgry': 'Gryphon Rider',
    'hgtw': 'Guard Tower',
    'hgyr': 'Flying Machine',
    'hhes': 'High Elf Swordman',
    'hhou': 'House',
    'Hjai': 'Jaina',
    'Hkal': 'Kael\'thas',
    'hkee': 'Keep',
    'hkni': 'Knight',
    'Hlgr': 'Garithos',
    'hlum': 'Lumber Mill',
    'Hmbr': 'Muradin',
    'hmil': 'Militia',
    'Hmkg': 'Mountain King',
    'hmpr': 'Priest',
    'hmtm': 'Mortar',
    'hmtt': 'Siege Engine',
    'Hpal': 'Paladin',
    'hpea': 'Peasant',
    'hrif': 'Rifleman',
    'hrtt': 'Siege Engine (Rocket)',
    'hsor': 'Sorceress',
    'hspt': 'Spell Breaker',
    'htow': 'Town Hall',
    'htws': 'Church',
    'hvlt': 'Arcane Vault',
    'Hvsh': 'Lady Vashj',
    'Hvwd': 'Sylvanus',
    'hwtw': 'Watch Tower',
    'nbal': 'Doomgaurd',
    'Nbbc': 'Chaos Blademaster',
    'ncap': 'Corrupt Protector',
    'ncaw': 'Corrup Ancient of War',
    'nchg': 'Chaos Grunt',
    'nchr': 'Chaos Raider',
    'nchw': 'Chaos Warlock',
    'nck': 'Chaos Kodo Beast',
    'ncmw': 'Corrupt Moon Well',
    'ncpn': 'Chaos Peon',
    'nctl': 'Corrupt Tree of Life',
    'ndmg': 'Demon Gate',
    'nefm': 'High Elf Farm',
    'negf': 'High Elf Earth',
    'negm': 'High Elf Sky',
    'negt': 'High Elf Guard Tower',
    'negt': 'High Elf Tower',
    'nenc': 'Corrupt Treant',
    'nenp': 'Poison Treant',
    'nepl': 'Plauge Treant',
    'nfel': 'Felhound',
    'nfr': 'Furbolg Tracker',
    'nfre': 'Furbolg Elder',
    'nfrg': 'Furbolg Champion',
    'nfrl': 'Furbolg',
    'nfrs': 'Furbolg Shaman',
    'ngsp': 'Sapper',
    'nhea': 'High Elf Archer',
    'nhe': 'High Elf Barracks',
    'nhew': 'Blood Elf Peasant',
    'nhyc': 'Dragon Turtle',
    'ninf': 'Infernal',
    'nmpe': 'Mur\'gul Slave',
    'nmyr': 'Myrmidon',
    'nnad': 'Altar of the Depths',
    'nnfm': 'Coral Bed',
    'Nngs': 'Naga Sorceress',
    'nnmg': 'Mur\'gul Reaver',
    'nnrg': 'Naga Royal Guard',
    'nnsa': 'Shrine of Azshara',
    'nnsg': 'Naga Spawning Grounds',
    'nnsw': 'Naga Siren',
    'nntg': 'Tidal Guardian',
    'nntt': 'Temple of Tides',
    'nomg': 'Ogre Magi',
    'npgf': 'Pig Farm',
    'Npld': 'Pit Lord',
    'nrwm': 'Orc Dragonrider',
    'nsat': 'Trickster',
    'nsfp': 'Forest Troll Shadow Priest',
    'nska': 'Skeleton Archer',
    'nskf': 'Burning Archer',
    'nskg': 'Giant Skeleton Warrior',
    'nskm': 'Skeletal Marksman',
    'nsnp': 'Snap Dragon',
    'nsth': 'Hellcaller',
    'nstl': 'Soulstealer',
    'nsts': 'Shadowdancer',
    'nsty': 'Satyr',
    'nw2w': 'Warcraft II Warlock',
    'nwgs': 'Couatl',
    'nws1': 'Dragon Hawk',
    'nzep': 'Zepplin',
    'oalt': 'Altar of Storms',
    'oang': 'Guardian',
    'obar': 'Orc Barracks',
    'obea': 'Beastiary',
    'Obla': 'Blademaster',
    'ocat': 'Catapult',
    'ocbw': 'Chaos Burrow',
    'odoc': 'Troll Witch Doctor',
    'Ofar': 'Far Seer',
    'ofor': 'Forge',
    'ofrt': 'Fortress',
    'ogre': 'Great Hall',
    'Ogrh': 'Grom Hellscream',
    'ogru': 'Grunt',
    'ohun': 'Troll Headhunter',
    'okod': 'Kodo Beast',
    'opeo': 'Peon',
    'Opgh': 'Chaos Grom Hellscream',
    'orai': 'Raider',
    'Oshd': 'Shadow Hunter',
    'oshm': 'Shaman',
    'osld': 'Spirit Lodge',
    'ospm': 'Spirit Walker (Metamophed)',
    'ospw': 'Spirit Walker',
    'ostr': 'Stronghold',
    'otau': 'Tauren',
    'otbk': 'Troll Berserker',
    'otbr': 'Troll Batrider',
    'Otch': 'Tauren Chieftain',
    'Othr': 'Thrall',
    'otr': 'Burrow',
    'otto': 'Tauren Totem',
    'ovln': 'Voodoo Lounge',
    'owtw': 'Orc Watch Tower',
    'owyv': 'Wyvern',
    'Rec': 'Upgrade Corrosive Breath',
    'Redc': 'Upgrade Druid of the Claw',
    'Redt': 'Upgrade Druid of the Talon',
    'Ree': 'Upgrade Mark of the Claw',
    'Reec': 'Upgrade Mark of the Talon',
    'Rehs': 'Upgrade Hardened Skin',
    'Reht': 'Upgrade Hippogryph Taming',
    'Rei': 'Upgrade Improved Bows',
    'Rema': 'Upgrade Moon Armor',
    'Remg': 'Upgrade Moon Glaive',
    'Remk': 'Upgrade Marksmanship',
    'Ren': 'Upgrade Nature\'s Blessing',
    'Repd': 'Upgrade Vorpal Blades',
    'Rerh': 'Upgrade Reinforced Hides',
    'Rers': 'Upgrade Resistant Skin',
    'Resc': 'Upgrade Sentinel',
    'Resi': 'Upgrade Abolish Magic',
    'Resm': 'Upgrade Strength of the Moon',
    'Resw': 'Upgrade Strength of the Wild',
    'Reuv': 'Upgrade Ultravision',
    'Rews': 'Upgrade Well Sprint',
    'Rhaa': 'Upgrade ARTILLERY',
    'Rhac': 'Upgrade Masonry',
    'Rhan': 'Upgrade Animal War Training',
    'Rhar': 'Upgrade Plating',
    'Rhcd': 'Upgrade Cloud',
    'Rhde': 'Upgrade Defend',
    'Rhfc': 'Upgrade Flak Cannons',
    'Rhfs': 'Upgrade Fragmentation Shards',
    'Rhg': 'Upgrade Flying Machine Bombs',
    'Rhh': 'Upgrade Storm Hammers',
    'Rhla': 'Upgrade Leather Armor',
    'Rhlh': 'Upgrade Lumber Harvesting',
    'Rhme': 'Upgrade Melee Weapons',
    'Rhmi': 'Upgrade GOLD',
    'Rhpt': 'Upgrade Priest Training',
    'Rhra': 'Upgrade Ranged Weapons',
    'Rhri': 'Upgrade Long Rifles',
    'Rhrt': 'Upgrade Barrage',
    'Rhse': 'Upgrade Magic Sentry',
    'Rhsr': 'Upgrade Flare',
    'Rhss': 'Upgrade Control Magic',
    'Rhst': 'Upgrade Sorceress Training',
    'Rnam': 'Upgrade Naga Armor',
    'Rnat': 'Upgrade Naga Attack',
    'Rnen': 'Upgrade Naga Ensnare',
    'Rnsi': 'Upgrade Naga Abolish Magic',
    'Rnsw': 'Upgrade Siren',
    'Roaa': 'Upgrade Orc Artillery',
    'Roar': 'Upgrade Unit Armor',
    'Robf': 'Upgrade Burning Oil',
    'Robk': 'Upgrade Berserker Upgrade',
    'Robs': 'Upgrade Berserker Strength',
    'Roch': 'Upgrade Chaos',
    'Roen': 'Upgrade Ensnare',
    'Rolf': 'Upgrade Liquid Fire',
    'Rome': 'Upgrade Melee Weapons',
    'Ropg': 'Upgrade Pillage',
    'Rora': 'Upgrade Ranged Weapons',
    'Ror': 'Upgrade Reinforced Defenses',
    'Rosp': 'Upgrade Spiked Barricades',
    'Rost': 'Upgrade Shaman Training',
    'Rotr': 'Upgrade Troll Regeneration',
    'Rovs': 'Upgrade Envenomed Spears',
    'Rowd': 'Upgrade Witch Doctor Training',
    'Rows': 'Upgrade Pulverize',
    'Rowt': 'Upgrade Spirit Walker Training',
    'Rua': 'Upgrade ABOM',
    'Ruac': 'Upgrade Cannibalize',
    'Ruar': 'Upgrade Unholy Armor',
    'Ruax': 'Upgrade ABOM_EXPL',
    'Ruba': 'Upgrade Banshee Training',
    'Rubu': 'Upgrade Burrow',
    'Rucr': 'Upgrade Creature Carapace',
    'Ruex': 'Upgrade Exhume Corpses',
    'Ruf': 'Upgrade Freezing Breath',
    'Rugf': 'Upgrade Ghoul Frenzy',
    'Rume': 'Upgrade Unholy Strength',
    'Rump': 'Upgrade MEAT_WAGON',
    'Rune': 'Upgrade Necromancer Training',
    'Rupc': 'Upgrade Disease Cloud',
    'Rura': 'Upgrade Creature Attack',
    'Rurs': 'Upgrade SACRIFICE',
    'Rusf': 'Upgrade Stone Form',
    'Rusl': 'Upgrade Skeletal Longevity',
    'Rusm': 'Upgrade Skeletal Mastery',
    'Rusp': 'Upgrade Destroyer Form',
    'Ruw': 'Upgrade We',
    'Rwdm': 'Upgrade War Drums Damage Increase',
    'uabo': 'Abomination',
    'uaco': 'Acolyte',
    'uaod': 'Altar of Darkness',
    'uar': 'Undead Barge',
    'uban': 'Banshee',
    'ubon': 'Boneyard',
    'ubsp': 'Destroyer',
    'Ucrl': 'Crypt Lord',
    'ucry': 'Crypt Fiend',
    'Udea': 'Death Knight',
    'Udre': 'Dread Lord',
    'Udth': 'Detheroc',
    'ufro': 'Frost Wyrm',
    'ugar': 'Gargoyle',
    'ugho': 'Ghoul',
    'ugol': 'Haunted Gold Mine',
    'ugrm': 'Gargoyle (Stone)',
    'ugrv': 'Graveyard',
    'ugsp': 'Gargoyle Spire',
    'Ulic': 'Lich',
    'Umal': 'Malganis',
    'umtw': 'Meat Wagon',
    'unec': 'Necromancer',
    'unp1': 'Halls of the Dead',
    'unp2': 'Black Citadel',
    'unpl': 'Necropolis',
    'uobs': 'Obsidian Statue',
    'usap': 'Sacrificial Pit',
    'usep': 'Crypt',
    'ushd': 'Shade',
    'uske': 'Skeleton Warrior',
    'uslh': 'Slaughterhouse',
    'Utic': 'Tichondrius',
    'utod': 'Temple of the Damned',
    'utom': 'Tomb of Relics',
    'uzg1': 'Spirit Tower',
    'uzg2': 'Nerubian Tower',
    'uzig': 'Ziggurat',
    //# Others
    'nskf': 'Burning Archer',
    'nws1': 'Dragon Hawk',
    'nban': 'Bandit',
    'nrog': 'Rogue',
    'nenf': 'Enforcer',
    'nass': 'Assassin',
    'nbdk': 'Black Drake',
    'nrdk': 'Red Dragon Whelp',
    'nbdr': 'Black Dragon Whelp',
    'nrdr': 'Red Drake',
    'nbwm': 'Black Dragon',
    'nrwm': 'Red Dragon',
    'nadr': 'Blue Dragon',
    'nadw': 'Blue Dragon Whelp',
    'nadk': 'Blue Drake',
    'nbzd': 'Bronze Dragon',
    'nbzk': 'Bronze Drake',
    'nbzw': 'Bronze Dragon Whelp',
    'ngrd': 'Green Dragon',
    'ngdk': 'Green Drake',
    'ngrw': 'Green Dragon Whelp',
    'ncea': 'Centaur Archer',
    'ncen': 'Centaur Outrunner',
    'ncer': 'Centaur Drudge',
    'ndth': 'Dark Troll High Priest',
    'ndtp': 'Dark Troll Shadow Priest',
    'ndt': 'Dark Troll Berserker',
    'ndtw': 'Dark Troll WarLord',
    'ndtr': 'Dark Troll',
    'ndtt': 'Dark Troll Trapper',
    'nfsh': 'Forest Troll High Priest',
    'nfsp': 'Forest Troll Shadow Priest',
    'nftr': 'Forest Troll',
    'nft': 'Forest Troll Berserker',
    'nftt': 'Forest Troll Trapper',
    'nftk': 'Forest Troll WarLord',
    'ngrk': 'Mud Golem',
    'ngir': 'Goblin Shredder',
    'nfrs': 'Furbolg Shaman',
    'ngna': 'Gnoll Poacher',
    'ngns': 'Gnoll Assassin',
    'ngno': 'Gnoll',
    'ngn': 'Gnoll Brute',
    'ngnw': 'Gnoll Warden',
    'ngnv': 'Gnoll Overseer',
    'ngsp': 'Goblin Sapper',
    'nhrr': 'Harpy Rogue',
    'nhrw': 'Harpy Windwitch',
    'nits': 'Ice Troll Berserker',
    'nitt': 'Ice Troll Trapper',
    'nko': 'Kobold',
    'nkog': 'Kobold Geomancer',
    'nthl': 'Thunder Lizard',
    'nmfs': 'Murloc Flesheater',
    'nmrr': 'Murloc Huntsman',
    'now': 'Wildkin',
    'nrzm': 'Razormane Medicine Man',
    'nnwa': 'Nerubian Warrior',
    'nnwl': 'Nerubian Webspinner',
    'nogr': 'Ogre Warrior',
    'nogm': 'Ogre Mauler',
    'nogl': 'Ogre Lord',
    'nomg': 'Ogre Magi',
    'nrvs': 'Frost Revenant',
    'nslf': 'Sludge Flinger',
    'nsts': 'Satyr Shadowdancer',
    'nstl': 'Satyr Soulstealer',
    'nzep': 'Goblin Zeppelin',
    'ntrt': 'Giant Sea Turtle',
    'nlds': 'Makrura Deepseer',
    'nlsn': 'Makrura Snapper',
    'nmsn': 'Mur\'gul Snarecaster',
    'nsc': 'Spider Crab Shorecrawler',
    'nbot': 'Transport Ship',
    'nsc2': 'Spider Crab Limbripper',
    'nsc3': 'Spider Crab Behemoth',
    'nbdm': 'Blue Dragonspawn Meddler',
    'nmgw': 'Magnataur Warrior',
    'nan': 'Barbed Arachnathid',
    'nanm': 'Barbed Arachnathid',
    'nfps': 'Polar Furbolg Shaman',
    'nmgv': 'Magic Vault',
    'nit': 'Icy Treasure Box',
    'npfl': 'Fel Beast',
    'ndrd': 'Draenei Darkslayer',
    'ndrm': 'Draenei Disciple',
    'nvdw': 'Voidwalker',
    'nvdg': 'Greater Voidwalker',
    'nnht': 'Nether Dragon Hatchling',
    'nndk': 'Nether Drake',
    'nndr': 'Nether Dragon',
    //# real items
    'LTlt': 'Tree',
    'nmer': 'Merchant',
    'ntav': 'Tavern',
    'ngol': 'Goldmine',
    'amrc': 'Amulet of Recall',
    'ankh': 'Ankh of Reincarnation',
    'belv': 'Boots of Quel\'Thalas +6',
    'bgst': 'Belt of Giant Strength +6',
    'bspd': 'Boots of Speed',
    'ccmd': 'Scepter of Mastery',
    'ciri': 'Robe of the Magi +6',
    'ckng': 'Crown of Kings +5',
    'clsd': 'Cloak of Shadows',
    'crys': 'Crystal Ball',
    'desc': 'Kelen\'s Dagger of Escape',
    'gemt': 'Gem of True Seeing',
    'gobm': 'Goblin Land Mines',
    'gsou': 'Soul Gem',
    'guvi': 'Glyph of Ultravision',
    'gfor': 'Glyph of Fortification',
    'soul': 'Soul',
    'mdp': 'Medusa Pebble',
    'rag1': 'Slippers of Agility +3',
    'rat3': 'Claws of Attack +3',
    'rin1': 'Mantle of Intelligence +3',
    'rde1': 'Ring of Protection +2',
    'rde2': 'Ring of Protection +3',
    'rde3': 'Ring of Protection +4',
    'rhth': 'Khadgar\'s Gem of Health',
    'rst1': 'Gauntlets of Ogre Strength +3',
    'ofir': 'Orb of Fire',
    'ofro': 'Orb of Frost',
    'olig': 'Orb of Lightning',
    'oli2': 'Orb of Lightning',
    'oven': 'Orb of Venom',
    'odef': 'Orb of Darkness',
    'ocor': 'Orb of Corruption',
    'pdiv': 'Potion of Divinity',
    'phea': 'Potion of Healing',
    'pghe': 'Potion of Greater Healing',
    'pinv': 'Potion of Invisibility',
    'pgin': 'Potion of Greater Invisibility',
    'pman': 'Potion of Mana',
    'pgma': 'Potion of Greater Mana',
    'pnvu': 'Potion of Invulnerability',
    'pnvl': 'Potion of Lesser Invulnerability',
    'pres': 'Potion of Restoration',
    'pspd': 'Potion of Speed',
    'rlif': 'Ring of Regeneration',
    'rwiz': 'Sobi Mask',
    'sfog': 'Horn of the Clouds',
    'shea': 'Scroll of Healing',
    'sman': 'Scroll of Mana',
    'spro': 'Scroll of Protection',
    'sres': 'Scroll of Restoration',
    'ssil': 'Staff of Silence',
    'stwp': 'Scroll of Town Portal',
    'tels': 'Goblin Night Scope',
    'tdex': 'Tome of Agility',
    'texp': 'Tome of Experience',
    'tint': 'Tome of Intelligence',
    'tkno': 'Tome of Power',
    'tstr': 'Tome of Strength',
    'ward': 'Warsong Battle Drums',
    'will': 'Wand of Illusion',
    'wneg': 'Wand of Negation',
    'rdis': 'Rune of Dispel Magic',
    'rwat': 'Rune of the Watcher',
    'fgrd': 'Red Drake Egg',
    'fgrg': 'Stone Token',
    'fgdg': 'Demonic Figurine',
    'fgfh': 'Spiked Collar',
    'fgsk': 'Book of the Dead',
    'engs': 'Enchanted Gemstone',
    'k3m1': 'Mooncrystal',
    'modt': 'Mask of Death',
    'sand': 'Scroll of Animate Dead',
    'srrc': 'Scroll of Resurrection',
    'sror': 'Scroll of the Beast',
    'infs': 'Inferno Stone',
    'shar': 'Ice Shard',
    'wild': 'Amulet of the Wild',
    'wswd': 'Sentry Wards',
    'whwd': 'Healing Wards',
    'wlsd': 'Wand of Lightning Shield',
    'wcyc': 'Wand of the Wind',
    'rnec': 'Rod of Necromancy',
    'pams': 'Anti-magic Potion',
    'clfm': 'Cloak of Flames',
    'evtl': 'Talisman of Evasion',
    'nspi': 'Necklace of Spell Immunity',
    'lhst': 'The Lion Horn of Stormwind',
    'kpin': 'Khadgar\'s Pipe of Insight',
    'sbch': 'Scourge Bone Chimes',
    'afac': 'Alleria\'s Flute of Accuracy',
    'ajen': 'Ancient Janggo of Endurance',
    'lgdh': 'Legion Doom-Horn',
    'hcun': 'Hood of Cunning',
    'mcou': 'Medallion of Courage',
    'hval': 'Helm of Valor',
    'cno': 'Circlet of Nobility',
    'prvt': 'Periapt of Vitality',
    'tgxp': 'Tome of Greater Experience',
    'mnst': 'Mana Stone',
    'hlst': 'Health Stone',
    'tpow': 'Tome of Knowledge',
    'tst2': 'Tome of Strength +2',
    'tin2': 'Tome of Intelligence +2',
    'tdx2': 'Tome of Agility +2',
    'rde0': 'Ring of Protection +1',
    'rde4': 'Ring of Protection +5',
    'rat6': 'Claws of Attack +6',
    'rat9': 'Claws of Attack +9',
    'ratc': 'Claws of Attack +12',
    'ratf': 'Claws of Attack +15',
    'manh': 'Manual of Health',
    'pmna': 'Pendant of Mana',
    'penr': 'Pendant of Energy',
    'gcel': 'Gloves of Haste',
    'totw': 'Talisman of the Wild',
    'phlt': 'Phat Lewt',
    'gopr': 'Glyph of Purification',
    'ches': 'Cheese',
    'mlst': 'Maul of Strength',
    'rnsp': 'Ring of Superiority',
    'brag': 'Bracer of Agility',
    'sksh': 'Skull Shield',
    'vddl': 'Voodoo Doll',
    'sprn': 'Spider Ring',
    'tmmt': 'Totem of Might',
    'anfg': 'Ancient Figurine',
    'lnrn': 'Lion\'s Ring',
    'iwbr': 'Ironwood Branch',
    'jdrn': 'Jade Ring',
    'drph': 'Druid Pouch',
    'hslv': 'Healing Salve',
    'pclr': 'Clarity Potion',
    'plcl': 'Lesser Clarity Potion',
    'rej1': 'Minor Replenishment Potion',
    'rej2': 'Lesser Replenishment Potion',
    'rej3': 'Replenishment Potion',
    'rej4': 'Greater Replenishment Potion',
    'rej5': 'Lesser Scroll of Replenishment',
    'rej6': 'Greater Scroll of Replenishment',
    'sreg': 'Scroll of Regeneration',
    'gold': 'Gold Coins',
    'lmbr': 'Bundle of Lumber',
    'fgun': 'Flare Gun',
    'pomn': 'Potion of Omniscience',
    'gomn': 'Glyph of Omniscience',
    'wneu': 'Wand of Neutralization',
    'silk': 'Spider Silk Broach',
    'lure': 'Monster Lure',
    'skul': 'Sacrificial Skull',
    'moon': 'Moonstone',
    'brac': 'Runed Bracers',
    'vamp': 'Vampiric Potion',
    'woms': 'Wand of Mana Stealing',
    'tcas': 'Tiny Castle',
    'tgrh': 'Tiny Great Hall',
    'tsct': 'Ivory Tower',
    'wshs': 'Wand of Shadowsight',
    'tret': 'Tome of Retraining',
    'sneg': 'Staff of Negation',
    'stel': 'Staff of Teleportation',
    'spre': 'Staff of Preservation',
    'mcri': 'Mechanical Critter',
    'spsh': 'Amulet of Spell Shield',
    'sbok': 'Spell Book',
    'ssan': 'Staff of Sanctuary',
    'shas': 'Scroll of Speed',
    'dust': 'Dust of Appearance',
    'oslo': 'Orb of Slow',
    'dsum': 'Diamond of Summoning',
    'sor1': 'Shadow Orb +1',
    'sor2': 'Shadow Orb +2',
    'sor3': 'Shadow Orb +3',
    'sor4': 'Shadow Orb +4',
    'sor5': 'Shadow Orb +5',
    'sor6': 'Shadow Orb +6',
    'sor7': 'Shadow Orb +7',
    'sor8': 'Shadow Orb +8',
    'sor9': 'Shadow Orb +9',
    'sora': 'Shadow Orb +10',
    'sorf': 'Shadow Orb Fragment',
    'fwss': 'Frost Wyrm Skull Shield',
    'ram1': 'Ring of the Archmagi',
    'ram2': 'Ring of the Archmagi',
    'ram3': 'Ring of the Archmagi',
    'ram4': 'Ring of the Archmagi',
    'shtm': 'Shamanic Totem',
    'shwd': 'Shimmerweed',
    'btst': 'Battle Standard',
    'skrt': 'Skeletal Artifact',
    'thle': 'Thunder Lizard Egg',
    'sclp': 'Secret Level Powerup',
    'gldo': 'Orb of Kil\'jaeden',
    'tbsm': 'Tiny Blacksmith',
    'tfar': 'Tiny Farm',
    'tlum': 'Tiny Lumber Mill',
    'tbar': 'Tiny Barracks',
    'tbak': 'Tiny Altar of Kings',
    'mgtk': 'Magic Key Chain',
    'stre': 'Staff of Reanimation',
    'horl': 'Sacred Relic',
    'hbth': 'Helm of Battlethirst',
    'blba': 'Bladebane Armor',
    'rugt': 'Runed Gauntlets',
    'frhg': 'Firehand Gauntlets',
    'gvsm': 'Gloves of Spell Mastery',
    'crdt': 'Crown of the DeathLord',
    'arsc': 'Arcane Scroll',
    'scul': 'Scroll of the Unholy Legion',
    'tmsc': 'Tome of Sacrifices',
    'dts': 'Drek\'thar\'s Spellbook',
    'grsl': 'Grimoire of Souls',
    'arsh': 'Arcanite Shield',
    'shdt': 'Shield of the DeathLord',
    'shhn': 'Shield of Honor',
    'shen': 'Enchanted Shield',
    'thdm': 'Thunderlizard Diamond',
    'stpg': 'Clockwork Penguin',
    'shrs': 'Shimmerglaze Roast',
    'bfhr': 'Bloodfeather\'s Heart',
    'cosl': 'Celestial Orb of Souls',
    'shcw': 'Shaman Claws',
    'srbd': 'Searing Blade',
    'frgd': 'Frostguard',
    'envl': 'Enchanted Vial',
    'rump': 'Rusty Mining Pick',
    'mort': 'Mogrin\'s Report',
    'srtl': 'Serathil',
    'stwa': 'Sturdy War Axe',
    'klmm': 'Killmaim',
    'rots': 'Scepter of the Sea',
    'axas': 'Ancestral Staff',
    'mnsf': 'Mindstaff',
    'schl': 'Scepter of Healing',
    'asbl': 'Assassin\'s Blade',
    'kgal': 'Keg of Ale',
    'dphe': 'Thunder Phoenix Egg',
    'dkfw': 'Keg of Thunderwater',
    'dth': 'Thunderbloom Bul',
    //# extra heros
    'Npbm': 'Pandaren Brewmaster',
    'Nbrn': 'Dark Ranger',
    'Nngs': 'Naga Sea Witch',
    'Nplh': 'Pit Lord',
    'Nbst': 'Beastmaster',
    'Ntin': 'Goblin Tinker',
    'Nfir': 'FireLord',
    'Nalc': 'Goblin Alchemist'
    //# extra hero abilities
};

const heroAbilities = {
    'AHbz': { 'displayName': 'Blizzard'},
    'AHwe': { 
     'displayName': 'Summon Water Elemental',
     'type': 'summon',
     'summonCount': 1,
     'summonItemId': ['hwat', 'hwt2', 'hwt3'],
     'summonDuration': 60
    },
    'AHa': { 'displayName': 'Brilliance Aura'},
    'AHmt': { 'displayName': 'Mass Teleport'},
    'AHt': { 'displayName': 'Storm Bolt'},
    'AHtc': { 'displayName': 'Thunder Clap'},
    'AHbh': { 'displayName': 'Bash'},
    'AHav': { 'displayName': 'Avatar'},
    'AHh': { 'displayName': 'Holy Light'},
    'AHds': { 'displayName': 'Divine Shield'},
    'AHad': { 'displayName': 'Devotion Aura'},
    'AHre': { 'displayName': 'Resurrection'},
    'AHdr': { 'displayName': 'Siphon Mana'},
    'AHfs': { 'displayName': 'Flame Strike'},
    'AHbn': { 'displayName': 'Banish'},
    'AHpx': { 'displayName': 'Summon Phoenix'},
    'AEm': { 'displayName': 'Mana Burn'},
    'AEim': { 'displayName': 'Immolation'},
    'AEev': { 'displayName': 'Evasion'},
    'AEme': { 'displayName': 'Metamorphosis'},
    'AEer': { 'displayName': 'Entangling Roots'},
    'AEfn': { 
        'displayName': 'Force of Nature',
        'type': 'summon',
        'summonCount': 2,
        'summonItemId': 'efon',
        'summonDuration': 60
    },
    'AEah': { 'displayName': 'Thorns Aura'},
    'AEtq': { 'displayName': 'Tranquility'},
    'AEst': { 'displayName': 'Scout'},
    'AHfa': { 'displayName': 'Searing Arrows'},
    'AEar': { 'displayName': 'Trueshot Aura'},
    'AEsf': { 'displayName': 'Starfall'},
    'AEbl': { 'displayName': 'Blink'},
    'AEfk': { 'displayName': 'Fan of Knives'},
    'AEsh': { 'displayName': 'Shadow Strike'},
    'AEsv': { 'displayName': 'Spirit of Vengeance'},
    'AOwk': { 'displayName': 'Wind Walk'},
    'AOmi': { 'displayName': 'Mirror Image'},
    'AOcr': { 'displayName': 'Critical Strike'},
    'AOww': { 'displayName': 'Bladestorm'},
    'AOcl': { 
    	'displayName': 'Chain Lighting',
    	'type': 'objectTarget'
    },
    'AOfs': { 
    	'displayName': 'Far Sight',
    	'type': 'pointTarget'
    },
    'AOsf': { 
        'displayName': 'Feral Spirit',
        'type': 'summon',
        'summonCount': 2,
        'summonDuration': 60,
        'summonUnique': true,
        'summonItemId': ['osw1', 'osw2', 'osw3']
    },
    'AOeq': { 'displayName': 'Earth Quake'},
    'AOsh': { 'displayName': 'Shockwave'},
    'AOae': { 'displayName': 'Endurance Aura'},
    'AOws': { 'displayName': 'War Stomp', 'type': 'summon', 'summonCount': 0, 'summonItemId': 'none'},
    'AOre': { 'displayName': 'Reincarnation'},
    'AOhw': { 'displayName': 'Healing Wave'},
    'AOhx': { 'displayName': 'Hex'},
    'AOsw': { 'displayName': 'Serpent Ward'},
    'AOvd': { 'displayName': 'Big Bad Voodoo'},
    'AUdc': { 'displayName': 'Death Coil'},
    'AUdp': { 'displayName': 'Death Pact'},
    'AUau': { 'displayName': 'Unholy Aura'},
    'AUan': { 'displayName': 'Animate Dead'},
    'AUcs': { 'displayName': 'Carrion Swarm'},
    'AUsl': { 'displayName': 'Sleep'},
    'AUav': { 'displayName': 'Vampiric Aura'},
    'AUin': { 'displayName': 'Inferno'},
    'AUfn': { 'displayName': 'Frost Nova'},
    'AUfa': { 'displayName': 'Frost Armor'},
    'AUfu': { 'displayName': 'Frost Armor'},
    'AUdr': { 'displayName': 'Dark Ritual'},
    'AUdd': { 'displayName': 'Death and Decay'},
    'AUim': { 'displayName': 'Impale'},
    'AUts': { 'displayName': 'Spiked Carapace'},
    'AUcb': { 
      'displayName': 'Carrion Beetles',
      'type': 'summon',
      'summonCount': 1,
      'summonItemId': 'ucs1',
      'summonDuration': 60
    },
    'AUls': { 'displayName': 'Locust Swarm'},
    'ANbf': { 'displayName': 'Breath of Fire'},
    'ANd':  { 'displayName': 'Drunken Brawler'},
    'ANdh': { 'displayName': 'Drunken Haze'},
    'ANef': { 'displayName': 'Storm Earth and Fire'},
    'ANdr': { 'displayName': 'Life Drain'},
    'ANsi': { 'displayName': 'Silence'},
    'ANba': { 'displayName': 'Black Arrow'},
    'ANch': { 'displayName': 'Charm'},
    'ANms': { 'displayName': 'Mana Shield'},
    'ANfa': { 'displayName': 'Frost Arrows'},
    'ANfl': { 'displayName': 'Forked Lightning'},
    'ANto': { 'displayName': 'Tornado'},
    'ANrf': { 'displayName': 'Rain of Fire'},
    'ANca': { 'displayName': 'Cleaving Attack'},
    'ANht': { 'displayName': 'Howl of Terror'},
    'ANdo': { 'displayName': 'Doom'},
    'ANsg': { 'displayName': 'Summon Bear'},
    'ANsq': { 'displayName': 'Summon Quilbeast'},
    'ANsw': { 'displayName': 'Summon Hawk'},
    'ANst': { 'displayName': 'Stampede'},
    'ANeg': { 'displayName': 'Engineering Upgrade'},
    'ANcs': { 'displayName': 'Cluster Rockets'},
    'ANc1': { 'displayName': 'Cluster Rockets 1'},
    'ANc2': { 'displayName': 'Cluster Rockets 2'},
    'ANc3': { 'displayName': 'Cluster Rockets 3'},
    'ANsy': { 'displayName': 'Pocket Factory'},
    'ANs1': { 'displayName': 'Pocket Factory 1'},
    'ANs2': { 'displayName': 'Pocket Factory 2'},
    'ANs3': { 'displayName': 'Pocket Factory 3'},
    'ANrg': { 'displayName': 'Robo-Goblin'},
    'ANg1': { 'displayName': 'Robo-Goblin 1'},
    'ANg2': { 'displayName': 'Robo-Goblin 2'},
    'ANg3': { 'displayName': 'Robo-Goblin 3'},
    'ANic': { 'displayName': 'Incinerate'},
    'ANia': { 'displayName': 'Incinerate'},
    'ANso': { 'displayName': 'Soul Burn'},
    'ANlm': { 'displayName': 'Summon Lava Spawn'},
    'ANvc': { 'displayName': 'Volcano'},
    'ANhs': { 'displayName': 'Healing Spray'},
    'ANa':  { 'displayName': 'Acid Bom'},
    'ANcr': { 'displayName': 'Chemical Rage'},
    'ANtm': { 'displayName': 'Transmute'}
};

const specialBuildings = {
    'tavern': 'ntav',
    'tree': 'LTlt',
    'merchant': 'nmer',
    'tavern': 'ntav',
    'goldmine':'ngol',
    'neutralShop': 'ngme',
    'playerShops': {
        'U': 'utom',
        'O': 'ovln',
        'E': 'eden',
        'H': 'hvlt'
    }
};

const buildingUpgrades = {
    'unp1': 'unpl',
    'unpl': 'unp2'
};

// building / resrach timings in seconds

const buildTimings = {
    'orge': 150,
    'ostr': 140
};

const heroes = Object.keys(unitMetaData).reduce((acc, key) => {
	let item = unitMetaData[key];
	if (item.hero) {
		acc[key] = `u_${item.displayName}`;
	}

	return acc;
}, {});

const abilityActions = {
	'RightClick': [ 3, 0, 13, 0 ],
    'AttackCommand': [ 15, 0, 13, 0 ],
    'MoveCommand': [ 18, 0, 13, 0 ],
	'CastSkillObject': [ -105, 0, 13, 0 ],
	'CastSkillTarget': [ 154, 0, 13, 0 ],
	'CastSummonSkill': [ 158, 0, 13, 0 ],
    'CastSummonSkillNoTarget': [ 74, 2, 13, 0 ],
    'UnsummonBuilding': [ -14, 0, 13, 0 ],
    'HeroItem1': [ 40, 0, 13, 0 ],
    'HeroItem2': [ 41, 0, 13, 0 ],
    'HeroItem3': [ 42, 0, 13, 0 ],
    'HeroItem4': [ 43, 0, 13, 0 ],
    'HeroItem5': [ 44, 0, 13, 0 ],
    'HeroItem6': [ 45, 0, 13, 0 ],
    'HeroMoveItem1': [ 34, 0, 13, 0 ],
    'HeroMoveItem2': [ 35, 0, 13, 0 ],
    'HeroMoveItem3': [ 36, 0, 13, 0 ],
    'HeroMoveItem4': [ 37, 0, 13, 0 ],
    'HeroMoveItem5': [ 38, 0, 13, 0 ],
    'HeroMoveItem6': [ 39, 0, 13, 0 ],
    'HeroRevive': [ 59, 0, 13, 0 ],
    'NERoot': [ 197, 0, 13, 0 ],
    'NEUpRoot': [ 198, 0, 13, 0 ],
    'EatTree': [ -78, 0, 13, 0 ],
    'SummonElemental': [ 129, 0, 13, 0 ],
    'SummonTreants': [ 208, 0, 13, 0 ]
};

const mapStartPositions = {
  '(8)battleground_lv.w3x': {
    '0': { x: -4224.0, y: -5696.0 },
    '1': { x:  -576.0, y: -5760.0 },
    '2': { x:  -832.0, y:  6912.0 },
    '3': { x:  6528.0, y: -5312.0 },
    '4': { x:  6720.0, y:  -384.0 },
    '5': { x:  5696.0, y:  4352.0 },
    '6': { x: -5248.0, y:  4800.0 },
    '7': { x: -6848.0, y:  -512.0 }
  },
  '(4)twistedmeadows.w3x': {
    '0': { x: -4608.0, y: -3904.0 },
    '1': { x: -3584.0, y:  4480.0 },
    '2': { x:  4672.0, y:  3456.0 },
    '3': { x:  3840.0, y: -5056.0 }
  },
  '(6)upperkingdom.w3x': {
    '0': { x: -6784.0,  y:  320.0  },
    '1': { x: -4224.0,  y: -4416.0 },
    '2': { x:   576.0,  y: -7104.0 },
    '3': { x:  -768.0,  y:  6528.0 },
    '4': { x:  4288.0,  y:  4032.0 },
    '5': { x:  6784.0,  y: -896.0  }
  },
  '(6)gnollwood.w3x': {
    '0': { x:  576.0,  y: 6528.0  },
    '1': { x: -6400.0, y: 3520.0  },
    '2': { x: -6976.0, y: -3328.0 },
    '3': { x:  192.0,  y: -7040.0 },
    '4': { x:  6720.0, y: -2944.0 },
    '5': { x:  7360.0, y: 3328.0  }
  },
  '(2)bootybay.w3m': {
      '0': { x: -5184.0, y: 2944.0 },
      '1': { x:  4672.0, y: 2944.0 }
  },
	'(2)echoisles.w3x': {
		'0': { x: -5184.0, y: 2944.0 },
		'1': { x:  4672.0, y: 2944.0 }
	},
  '(2)concealedhill.w3x': {
    '0': { x:  2176.0, y:  4224.0 },
    '1': { x: -2304.0, y: -4736.0 }
  },
  '(2)northernisles.w3x': {
    '0': { x: -2752.0, y: -3328.0 },
    '1': { x:  6912.0, y:  3264.0 }
  },
  '(2)terenasstand_lv.w3x': {
    '0': { x: -4096.0, y:  3968.0 },
    '1': { x:  4096.0, y: -4608.0 }
  },
  '(4)synergybigpaved.w3x': {
    '0': { x:  768.0, y: -4736.0 },
    '1': { x: -448.0, y: -4736.0 },
    '2': { x:  448.0, y:  4608.0 },
    '3': { x: -768.0, y:  4608.0 }
  },
  '(8)friends.w3x': {
    '0': { x:  1088, y:  7296 },
    '1': { x: -832,  y:  7296 },
    '2': { x:  320,  y: -7488 },
    '3': { x: -1536, y: -7488 },
    '4': { x: -6592, y: -960  },
    '5': { x: -6592, y:  896  },
    '6': { x:  7168, y:  896  },
    '7': { x:  7232, y: -1024 }
  },
  '(2)amazonia.w3x': {
   0: { x:  3328.0, y: 3072.0 },
   1: { x: -3392.0, y: -584.0 }
  },
  '(2)lastrefuge.w3x': {
    '0': { x: -3840.0, y: -3968.0 },
    '1': { x:  3840.0, y:  3264.0 }
  }
};

const commonMapNames = {
  'echoisles': '(2)echoisles.w3x'
};

const mapDataByFile = {
  '(2)lastrefuge.w3x': {
    'name': 'LastRefuge',
    'bounds': {
      'camera': [
        [ -4864,  4864 ],
        [  4864, -5376 ]
      ],
      'map': [
        [ -6144,   6144 ],
        [  6144,  -6144 ]
      ]
    },
    'gridSize': {
      'full': [ 96, 96 ],
      'playable': [ 84, 84 ]
    }
  },
  '(2)amazonia.w3x': {
    'name': 'Amazonia',
    'bounds': {
      'camera': [
        [ -4608,  4608 ],
        [  4608, -5120 ]
      ],
      'map': [
        [ -6144,   6144 ],
        [  6144,  -6144 ]
      ]
    },
    'gridSize': {
      'full': [ 96, 96 ],
      'playable': [ 80, 80 ]
    }
  },
  '(8)battleground_lv.w3x': {
    'name': 'Battleground',
    'bounds': {
      'camera': [
        [ -7680,  7680 ],
        [  7808, -8064 ]
      ],
      'map': [
        [ -10240,   10240 ],
        [  10240,  -10240 ]
      ]
    },
    'gridSize': {
      'full': [ 160, 160 ],
      'playable': [ 128, 128 ]
    }
  },
  '(4)twistedmeadows.w3x': {
    'name': 'TwistedMeadows',
    'bounds': {
      'camera': [
        [ -7424,  7424 ],
        [  7424, -7936 ]
      ],
      'map': [
        [ -10240,   10240 ],
        [  10240,  -10240 ]
      ]
    },
    'gridSize': {
      'full': [ 160, 160 ],
      'playable': [ 124, 124 ]
    }
  },
  '(6)upperkingdom.w3x': {
    'name': 'UpperKingdom',
    'bounds': {
      'camera': [
        [ -7936,  7936 ],
        [  7936, -8448 ]
      ],
      'map': [
        [ -10240,   10240 ],
        [  10240,  -10240 ]
      ]
    },
    'gridSize': {
      'full': [ 160, 160 ],
      'playable': [ 132, 132 ]
    }
  },
  '(6)gnollwood.w3x': {
    'name': 'GnollWood',
    'bounds': {
      'camera': [
        [ -7424,  7936 ],
        [  7680, -8192 ]
      ],
      'map': [
        [ -9984,   10496 ],
        [  9984,  -10496 ]
      ]
    },
    'gridSize': {
      'full': [ 160, 160 ],
      'playable': [ 128, 128 ]
    }
  },
  '(2)concealedhill.w3x': {
    'name': 'ConcealedHill',
    'bounds': {
      'camera': [
        [ -4864,  4864 ],
        [  6912, -7424 ]
      ],
      'map': [
        [ -6144,  6144 ],
        [  8192, -8192 ]
      ]
    },
    'gridSize': {
      'full':     [ 96, 128 ],
      'playable': [ 84, 116 ]
    }
  },
  '(2)echoisles.w3x': {
    'name': 'EchoIsles',
    'bounds': {
      'camera': [
        [ -6912,  6912 ],
        [  4864, -5376 ]
      ],
      'map': [
        [ -8192,  8192 ],
        [  6144, -6144 ]
      ]
    },
    'gridSize': {
      'full':     [ 128, 96 ],
      'playable': [ 116, 84 ]
    }
  },

  '(2)northernisles.w3x': {
    'name': 'NorthernIsles',
    'bounds': {
      'camera': [
        [ -4352,  8448 ],
        [  5248, -5248 ]
      ],
      'map': [
        [ -6144,  10240 ],
        [  6144, -6144  ]
      ]
    },
    'gridSize': {
      'full': [ 128, 96 ],
      'playable': [ 108, 86 ]
    }
  },
  '(2)terenasstand_lv.w3x': {
    'name': 'TerenasStandLV',
    'bounds': {
      'camera': [
        [ -4864,  4864 ],
        [  4864, -5376 ]
      ],
      'map': [
        [ -6144,  6144 ],
        [  6144, -6144  ]
      ]
    },
    'gridSize': {
      'full': [ 96, 96 ],
      'playable': [ 84, 84 ]
    }
  },
  '(4)synergybigpaved.w3x': {
    'name': 'SynergyBigPaved',
    'bounds': {
      'camera': [
        [ -7424,  7424 ],
        [  6784, -6784 ]
      ],
      'map': [
        [ -10240,  10240 ],
        [  10240, -10240  ]
      ]
    },
    'gridSize': {
      'full': [ 160, 160 ],
      'playable': [ 124, 110 ]
    }
  }
};

const abilityFlagNames = {
  'CancelTrainOrResearch': 64, // 0x40
	'LearnSkillOrTrain': 66,     // 0x42
	'Summon': 68,                // 0x44
  'TrainUnit': 70              // 0x46
};

const itemAbilityData = {
    'rnec': { 
      'ability': 0x10,
      'type': 'summon',
      'uses': 4,
      'stockCount': 1,
      'stockReplenish': 60,
      'cooldown': 22,
      'summonCount': 2,
      'summonItemId': 'uske',
      'summonDuration': 65
    },
    'stwp': {
      'ability': 0x12
    },
    'AHwe': {
      'ability': 0x10,
      'type': 'summon',
      'summonCount': 1,
      'summonItemId': ['hwat', 'hwt2', 'hwt3'],
      'summonDuration': 60
    }
};

const getUnitInfo = (itemId) => {
	const inBuildingList = !!(buildings[itemId]);
	const inUnitList = !!(units[itemId]);
	const inHeroList = !!(heroes[itemId]);
  const inItemList = !!(items[itemId]);

	const isBuildingUpgrade = (inUnitList && units[itemId].startsWith("b"));
	const isBuilding = (inBuildingList || isBuildingUpgrade);
	const isHero = (inHeroList);
	const isUnit = (inUnitList || isHero && !isBuilding);
  const isItem = (inItemList);

  const isKnownId = !!(allItemIds[itemId]);

  let isPlayerShop = false;
	let displayName = `Unknown (${itemId})`;

	if (isBuilding) {
		displayName = isBuildingUpgrade ? units[itemId] : buildings[itemId];

    const shopRace = Object.keys(specialBuildings.playerShops).find(key => {
        return specialBuildings.playerShops[key] === itemId;
    });

    if (shopRace) { 
        isPlayerShop = true;
    }

	} else if (isUnit) {
		displayName = units[itemId] || heroes[itemId];
  } else if (isItem) {
    displayName = items[itemId];
	} else if (isKnownId) {
    displayName = allItemIds[itemId];
}

	if (displayName.startsWith("u_") || 
      displayName.startsWith("b_") ||
      displayName.startsWith("i_")) {
		displayName = displayName.substring(2);
	}

	let meta = unitMetaData[itemId] || {
		hero: false,
		worker: false,
		permanent: isBuilding,
        playerShop: isPlayerShop,
        evolution: null,
        movespeed: 200 // default unknown ms
	};

	return {
		displayName: displayName,
		isBuilding: isBuilding,
		isUnit: isUnit,
    isItem: isItem,
		meta: meta
	};
};

module.exports = {
	getUnitInfo,
	buildings,
  buildingUpgrades,
	units,
	unitMetaData,
  specialBuildings,
	heroAbilities,
	abilityActions,
	abilityFlagNames,
  workerForRace,
	mapStartPositions,
  mapDataByFile,
  commonMapNames,
  buildTimings,
  itemAbilityData,
  abilityToHero
};
