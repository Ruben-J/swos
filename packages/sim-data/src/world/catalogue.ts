/**
 * Catalogus van herkenbare maar bewust "verbasterde" clubnamen uit zes landen.
 * De namen zijn licht gewijzigd (SWOS-stijl) zodat ze herkenbaar blijven zonder
 * exact gelijk te zijn aan echte merken. Steden zijn echte feiten.
 */

export interface ClubSeed {
  /** Verbasterde herkenbare clubnaam, bv. "Manchester Red", "Barcedona". */
  name: string;
  /** 3 letters, hoofdletters. */
  short: string;
  /** Echte stad (steden zijn feiten, geen merk). */
  city: string;
  /** Relatieve sterkte 0..1 (topclub ~0.92, promovendus/kleine club ~0.40). */
  strength: number;
  /** [primaire shirtkleur, secundaire] als CSS hex. Benader de echte clubkleuren. */
  colors: [string, string];
}

export interface DivisionSeed {
  /** Verbasterde competitienaam, bv. "Premier Liga", "Kampioenschap". */
  name: string;
  /** 1 = hoogste divisie, 2 = tweede, enz. */
  tier: number;
  /** Aantal clubs dat promoveert (alleen relevant voor tier >= 2). */
  promotion: number;
  /** Aantal clubs dat degradeert (alleen relevant als er een lagere divisie is). */
  relegation: number;
  clubs: ClubSeed[];
}

export interface CountrySeed {
  /** 3-letter landcode, bv. "ENG". */
  code: string;
  /** Nederlandse landnaam, bv. "Engeland". */
  name: string;
  divisions: DivisionSeed[];
}

export const COUNTRIES: CountrySeed[] = [
  {
    code: "ENG",
    name: "Engeland",
    divisions: [
      {
        name: "Premier Liga",
        tier: 1,
        promotion: 0,
        relegation: 3,
        clubs: [
          { name: "Manchester Red", short: "MNR", city: "Manchester", strength: 0.91, colors: ["#da291c", "#ffffff"] },
          { name: "Manchester Sky", short: "MNS", city: "Manchester", strength: 0.93, colors: ["#6cabdd", "#ffffff"] },
          { name: "Liverbird", short: "LIV", city: "Liverpool", strength: 0.90, colors: ["#c8102e", "#ffffff"] },
          { name: "Chelsford", short: "CHE", city: "Londen", strength: 0.84, colors: ["#034694", "#ffffff"] },
          { name: "Arsanal", short: "ARS", city: "Londen", strength: 0.88, colors: ["#ef0107", "#ffffff"] },
          { name: "Tottenford", short: "TOT", city: "Londen", strength: 0.82, colors: ["#ffffff", "#132257"] },
          { name: "Newcastle Magpies", short: "NEW", city: "Newcastle", strength: 0.80, colors: ["#241f20", "#ffffff"] },
          { name: "Aston Villard", short: "AVL", city: "Birmingham", strength: 0.78, colors: ["#7a003c", "#95bfe5"] },
          { name: "West Hammers", short: "WHU", city: "Londen", strength: 0.72, colors: ["#7a263a", "#1bb1e7"] },
          { name: "Brighten", short: "BRI", city: "Brighton", strength: 0.71, colors: ["#0057b8", "#ffffff"] },
          { name: "Crystal Palas", short: "CRY", city: "Londen", strength: 0.66, colors: ["#1b458f", "#c4122e"] },
          { name: "Wolveston", short: "WOL", city: "Wolverhampton", strength: 0.64, colors: ["#fdb913", "#231f20"] },
          { name: "Everson", short: "EVE", city: "Liverpool", strength: 0.63, colors: ["#003399", "#ffffff"] },
          { name: "Fullham", short: "FUL", city: "Londen", strength: 0.62, colors: ["#ffffff", "#000000"] },
          { name: "Brentforth", short: "BRE", city: "Londen", strength: 0.60, colors: ["#e30613", "#ffffff"] },
          { name: "Nottingham Forst", short: "NFO", city: "Nottingham", strength: 0.58, colors: ["#dd0000", "#ffffff"] },
        ],
      },
      {
        name: "Kampioenschap",
        tier: 2,
        promotion: 3,
        relegation: 0,
        clubs: [
          { name: "Leeds Whites", short: "LEE", city: "Leeds", strength: 0.59, colors: ["#ffffff", "#1d428a"] },
          { name: "Leicestra City", short: "LEI", city: "Leicester", strength: 0.58, colors: ["#003090", "#ffffff"] },
          { name: "Southhampton", short: "SOU", city: "Southampton", strength: 0.56, colors: ["#d71920", "#ffffff"] },
          { name: "Ipswick Town", short: "IPS", city: "Ipswich", strength: 0.55, colors: ["#0044a9", "#ffffff"] },
          { name: "Norwick City", short: "NOR", city: "Norwich", strength: 0.54, colors: ["#fff200", "#00a650"] },
          { name: "Sheffield Unite", short: "SHU", city: "Sheffield", strength: 0.53, colors: ["#ee2737", "#000000"] },
          { name: "Middlesborough", short: "MID", city: "Middlesbrough", strength: 0.52, colors: ["#d71920", "#ffffff"] },
          { name: "West Bromwick", short: "WBA", city: "West Bromwich", strength: 0.51, colors: ["#091453", "#ffffff"] },
          { name: "Coventree City", short: "COV", city: "Coventry", strength: 0.50, colors: ["#6cabdd", "#ffffff"] },
          { name: "Sunderlund", short: "SUN", city: "Sunderland", strength: 0.50, colors: ["#eb172b", "#ffffff"] },
          { name: "Hull Tigers", short: "HUL", city: "Hull", strength: 0.48, colors: ["#f18a01", "#000000"] },
          { name: "Bristle City", short: "BRC", city: "Bristol", strength: 0.47, colors: ["#e21c38", "#ffffff"] },
          { name: "Preston Endeavour", short: "PRE", city: "Preston", strength: 0.46, colors: ["#ffffff", "#0b1f6b"] },
          { name: "Cardyff City", short: "CAR", city: "Cardiff", strength: 0.45, colors: ["#0070b5", "#ffffff"] },
          { name: "Swanzee City", short: "SWA", city: "Swansea", strength: 0.44, colors: ["#ffffff", "#000000"] },
          { name: "Plymuth Argyle", short: "PLY", city: "Plymouth", strength: 0.41, colors: ["#003d2d", "#ffffff"] },
        ],
      },
    ],
  },
  {
    code: "FRA",
    name: "Frankrijk",
    divisions: [
      {
        name: "Ligue Un",
        tier: 1,
        promotion: 0,
        relegation: 3,
        clubs: [
          { name: "Paris Saint-Germond", short: "PSG", city: "Parijs", strength: 0.94, colors: ["#004170", "#da291c"] },
          { name: "Olympia Marseyu", short: "MAR", city: "Marseille", strength: 0.79, colors: ["#2faee0", "#ffffff"] },
          { name: "Olympia Lyonne", short: "LYO", city: "Lyon", strength: 0.76, colors: ["#ffffff", "#1f3a93"] },
          { name: "Monacco", short: "MON", city: "Monaco", strength: 0.78, colors: ["#e51b22", "#ffffff"] },
          { name: "Lille OSV", short: "LIL", city: "Lille", strength: 0.74, colors: ["#e01e24", "#ffffff"] },
          { name: "Rennais", short: "REN", city: "Rennes", strength: 0.70, colors: ["#e23026", "#000000"] },
          { name: "Nicea", short: "NIC", city: "Nice", strength: 0.69, colors: ["#cc0000", "#000000"] },
          { name: "Lens Sang et Or", short: "LEN", city: "Lens", strength: 0.68, colors: ["#fff200", "#e2231a"] },
          { name: "Strasburg", short: "STR", city: "Straatsburg", strength: 0.62, colors: ["#0e75bc", "#ffffff"] },
          { name: "Nantais", short: "NAN", city: "Nantes", strength: 0.58, colors: ["#fdd835", "#008f4c"] },
          { name: "Montpelliar", short: "MTP", city: "Montpellier", strength: 0.57, colors: ["#f37021", "#102c54"] },
          { name: "Brestois", short: "BRE", city: "Brest", strength: 0.56, colors: ["#d6001c", "#ffffff"] },
          { name: "Toulose", short: "TLS", city: "Toulouse", strength: 0.55, colors: ["#5f259f", "#ffffff"] },
          { name: "Reimes", short: "REI", city: "Reims", strength: 0.54, colors: ["#e2231a", "#ffffff"] },
          { name: "Le Havra", short: "LEH", city: "Le Havre", strength: 0.50, colors: ["#0a3a82", "#7ec0ee"] },
          { name: "Auxerra", short: "AUX", city: "Auxerre", strength: 0.49, colors: ["#ffffff", "#1a4ea0"] },
        ],
      },
      {
        name: "Ligue Deux",
        tier: 2,
        promotion: 3,
        relegation: 0,
        clubs: [
          { name: "Saint-Etiana", short: "STE", city: "Saint-Étienne", strength: 0.56, colors: ["#009639", "#ffffff"] },
          { name: "Bordeux", short: "BOR", city: "Bordeaux", strength: 0.54, colors: ["#16204a", "#9b1c2e"] },
          { name: "Metze", short: "MET", city: "Metz", strength: 0.53, colors: ["#841a2b", "#ffffff"] },
          { name: "Lorienne", short: "LOR", city: "Lorient", strength: 0.52, colors: ["#f37021", "#000000"] },
          { name: "Caenn", short: "CAE", city: "Caen", strength: 0.50, colors: ["#0a3a82", "#e2231a"] },
          { name: "Guingampe", short: "GUI", city: "Guingamp", strength: 0.49, colors: ["#e2231a", "#000000"] },
          { name: "Grenoblo", short: "GRE", city: "Grenoble", strength: 0.48, colors: ["#0e75bc", "#ffffff"] },
          { name: "Amienne", short: "AMI", city: "Amiens", strength: 0.47, colors: ["#000000", "#ffffff"] },
          { name: "Bastia", short: "BAS", city: "Bastia", strength: 0.46, colors: ["#0a3a82", "#ffffff"] },
          { name: "Pau Bearn", short: "PAU", city: "Pau", strength: 0.45, colors: ["#0e9b4c", "#ffffff"] },
          { name: "Rodeze", short: "ROD", city: "Rodez", strength: 0.44, colors: ["#e2231a", "#000000"] },
          { name: "Annecie", short: "ANN", city: "Annecy", strength: 0.43, colors: ["#e2231a", "#ffffff"] },
          { name: "Laval Stade", short: "LAV", city: "Laval", strength: 0.43, colors: ["#f58220", "#000000"] },
          { name: "Dunquerke", short: "DUN", city: "Duinkerke", strength: 0.42, colors: ["#e2231a", "#16204a"] },
          { name: "Troyas", short: "TRO", city: "Troyes", strength: 0.41, colors: ["#0a3a82", "#ffffff"] },
          { name: "Clermonte", short: "CLE", city: "Clermont-Ferrand", strength: 0.40, colors: ["#c8102e", "#1a4ea0"] },
        ],
      },
    ],
  },
  {
    code: "GER",
    name: "Duitsland",
    divisions: [
      {
        name: "Bundesklasse",
        tier: 1,
        promotion: 0,
        relegation: 3,
        clubs: [
          { name: "Bayron München", short: "BAY", city: "München", strength: 0.94, colors: ["#dc052d", "#ffffff"] },
          { name: "Borusso Dortmun", short: "DOR", city: "Dortmund", strength: 0.85, colors: ["#fde100", "#000000"] },
          { name: "Bayer Leverkusan", short: "LEV", city: "Leverkusen", strength: 0.86, colors: ["#e32219", "#000000"] },
          { name: "RB Leipzog", short: "RBL", city: "Leipzig", strength: 0.82, colors: ["#dd0741", "#ffffff"] },
          { name: "Eintracht Frankfort", short: "SGE", city: "Frankfurt", strength: 0.74, colors: ["#e1000f", "#000000"] },
          { name: "Stuttgardt", short: "STU", city: "Stuttgart", strength: 0.73, colors: ["#ffffff", "#e30613"] },
          { name: "Borusso Gladbök", short: "BMG", city: "Mönchengladbach", strength: 0.66, colors: ["#000000", "#00a650"] },
          { name: "Wolfsborg", short: "WOB", city: "Wolfsburg", strength: 0.65, colors: ["#65b32e", "#ffffff"] },
          { name: "Werder Bremn", short: "BRE", city: "Bremen", strength: 0.62, colors: ["#1d9053", "#ffffff"] },
          { name: "Hoffenheym", short: "HOF", city: "Sinsheim", strength: 0.60, colors: ["#1961b5", "#ffffff"] },
          { name: "Freiborg", short: "FRE", city: "Freiburg", strength: 0.61, colors: ["#000000", "#e2231a"] },
          { name: "Mainze 05", short: "MAI", city: "Mainz", strength: 0.59, colors: ["#c3141e", "#ffffff"] },
          { name: "Augsborg", short: "AUG", city: "Augsburg", strength: 0.55, colors: ["#ba3733", "#46714d"] },
          { name: "Union Berlyn", short: "UNB", city: "Berlijn", strength: 0.57, colors: ["#eb1923", "#ffe600"] },
          { name: "Köln Geissbock", short: "KOL", city: "Keulen", strength: 0.52, colors: ["#ed1c24", "#ffffff"] },
          { name: "Bochom 1848", short: "BOC", city: "Bochum", strength: 0.48, colors: ["#005ca9", "#ffffff"] },
        ],
      },
      {
        name: "Bundesklasse 2",
        tier: 2,
        promotion: 3,
        relegation: 0,
        clubs: [
          { name: "Hamborg SV", short: "HSV", city: "Hamburg", strength: 0.58, colors: ["#0a3a82", "#ffffff"] },
          { name: "Schalka 04", short: "S04", city: "Gelsenkirchen", strength: 0.56, colors: ["#004d9d", "#ffffff"] },
          { name: "Herta Berlyn", short: "BSC", city: "Berlijn", strength: 0.55, colors: ["#005ca9", "#ffffff"] },
          { name: "Fortuna Düsseldarf", short: "F95", city: "Düsseldorf", strength: 0.53, colors: ["#e2231a", "#ffffff"] },
          { name: "Kaiserslautarn", short: "FCK", city: "Kaiserslautern", strength: 0.52, colors: ["#e2231a", "#ffffff"] },
          { name: "Hannovar 96", short: "H96", city: "Hannover", strength: 0.51, colors: ["#00963f", "#000000"] },
          { name: "Karlsruer SC", short: "KSC", city: "Karlsruhe", strength: 0.50, colors: ["#005ca9", "#ffffff"] },
          { name: "Nürnborg", short: "FCN", city: "Neurenberg", strength: 0.49, colors: ["#ad1732", "#ffffff"] },
          { name: "Paderborne 07", short: "SCP", city: "Paderborn", strength: 0.48, colors: ["#005ca9", "#000000"] },
          { name: "Magdeborg", short: "FCM", city: "Maagdenburg", strength: 0.47, colors: ["#005ca9", "#ffffff"] },
          { name: "Greuther Fürthe", short: "SGF", city: "Fürth", strength: 0.45, colors: ["#00963f", "#ffffff"] },
          { name: "Darmstadt 98", short: "SVD", city: "Darmstadt", strength: 0.44, colors: ["#005ca9", "#ffffff"] },
          { name: "Elversborg", short: "ELV", city: "Bielefeld", strength: 0.43, colors: ["#fff200", "#005ca9"] },
          { name: "Braunschwyg", short: "EBS", city: "Braunschweig", strength: 0.42, colors: ["#fdb913", "#005ca9"] },
          { name: "Münstar", short: "SCM", city: "Münster", strength: 0.40, colors: ["#00963f", "#ffffff"] },
          { name: "Ulme 1846", short: "ULM", city: "Ulm", strength: 0.39, colors: ["#ffffff", "#000000"] },
        ],
      },
    ],
  },
  {
    code: "ITA",
    name: "Italië",
    divisions: [
      {
        name: "Seria A",
        tier: 1,
        promotion: 0,
        relegation: 3,
        clubs: [
          { name: "Juvextus", short: "JUV", city: "Turijn", strength: 0.86, colors: ["#000000", "#ffffff"] },
          { name: "Internazio", short: "INT", city: "Milaan", strength: 0.90, colors: ["#0068a8", "#000000"] },
          { name: "AC Milano", short: "MIL", city: "Milaan", strength: 0.85, colors: ["#fb090b", "#000000"] },
          { name: "Napola", short: "NAP", city: "Napels", strength: 0.88, colors: ["#12a0d7", "#ffffff"] },
          { name: "AS Romano", short: "ROM", city: "Rome", strength: 0.78, colors: ["#8e1f2f", "#f0bc42"] },
          { name: "Lazia", short: "LAZ", city: "Rome", strength: 0.74, colors: ["#87d8f7", "#ffffff"] },
          { name: "Atalanta Dea", short: "ATA", city: "Bergamo", strength: 0.80, colors: ["#1e71b8", "#000000"] },
          { name: "Fiorentyna", short: "FIO", city: "Florence", strength: 0.70, colors: ["#592c82", "#ffffff"] },
          { name: "Bolonia", short: "BOL", city: "Bologna", strength: 0.69, colors: ["#a21c25", "#1a2d5e"] },
          { name: "Torrino", short: "TOR", city: "Turijn", strength: 0.62, colors: ["#881420", "#ffffff"] },
          { name: "Udinesa", short: "UDI", city: "Udine", strength: 0.58, colors: ["#000000", "#ffffff"] },
          { name: "Genoa Grifone", short: "GEN", city: "Genua", strength: 0.56, colors: ["#a21c25", "#1a2d5e"] },
          { name: "Sampdorio", short: "SAM", city: "Genua", strength: 0.55, colors: ["#1b5497", "#ffffff"] },
          { name: "Cagliara", short: "CAG", city: "Cagliari", strength: 0.50, colors: ["#a21c25", "#1a2d5e"] },
          { name: "Hellas Verono", short: "VER", city: "Verona", strength: 0.49, colors: ["#fff200", "#1a2d5e"] },
          { name: "Lecca", short: "LEC", city: "Lecce", strength: 0.47, colors: ["#fff200", "#a2122a"] },
        ],
      },
      {
        name: "Seria B",
        tier: 2,
        promotion: 3,
        relegation: 0,
        clubs: [
          { name: "Palerma", short: "PAL", city: "Palermo", strength: 0.55, colors: ["#f4a7c0", "#000000"] },
          { name: "Parmesan", short: "PAR", city: "Parma", strength: 0.54, colors: ["#fff200", "#1a4ea0"] },
          { name: "Cremonesa", short: "CRE", city: "Cremona", strength: 0.52, colors: ["#a21c25", "#1a2d5e"] },
          { name: "Brescio", short: "BRE", city: "Brescia", strength: 0.51, colors: ["#1a4ea0", "#ffffff"] },
          { name: "Sampdoro Marina", short: "SDM", city: "Genua", strength: 0.50, colors: ["#1b5497", "#ffffff"] },
          { name: "Spezzia", short: "SPE", city: "La Spezia", strength: 0.49, colors: ["#ffffff", "#000000"] },
          { name: "Pisa Nerazzura", short: "PIS", city: "Pisa", strength: 0.48, colors: ["#1a2d5e", "#000000"] },
          { name: "Sassolo", short: "SAS", city: "Sassuolo", strength: 0.50, colors: ["#00a14b", "#000000"] },
          { name: "Frosinona", short: "FRO", city: "Frosinone", strength: 0.47, colors: ["#fff200", "#1a4ea0"] },
          { name: "Cosenzo", short: "COS", city: "Cosenza", strength: 0.45, colors: ["#a21c25", "#1a4ea0"] },
          { name: "Bari Galletti", short: "BAR", city: "Bari", strength: 0.46, colors: ["#a21c25", "#ffffff"] },
          { name: "Catanzara", short: "CAT", city: "Catanzaro", strength: 0.44, colors: ["#fff200", "#a21c25"] },
          { name: "Modeno", short: "MOD", city: "Modena", strength: 0.43, colors: ["#fff200", "#1a2d5e"] },
          { name: "Reggiona", short: "REG", city: "Reggio Emilia", strength: 0.42, colors: ["#a21c25", "#ffffff"] },
          { name: "Cittadello", short: "CIT", city: "Cittadella", strength: 0.40, colors: ["#a21c25", "#ffffff"] },
          { name: "Sudtirola", short: "SUD", city: "Bolzano", strength: 0.39, colors: ["#ffffff", "#a21c25"] },
        ],
      },
    ],
  },
  {
    code: "ESP",
    name: "Spanje",
    divisions: [
      {
        name: "Liga Espana",
        tier: 1,
        promotion: 0,
        relegation: 3,
        clubs: [
          { name: "Real Madrina", short: "RMA", city: "Madrid", strength: 0.95, colors: ["#ffffff", "#febe10"] },
          { name: "Barcedona", short: "BAR", city: "Barcelona", strength: 0.92, colors: ["#a50044", "#004d98"] },
          { name: "Atletra Madrid", short: "ATM", city: "Madrid", strength: 0.86, colors: ["#cb3524", "#ffffff"] },
          { name: "Athletro Bilbao", short: "ATH", city: "Bilbao", strength: 0.76, colors: ["#ee2523", "#ffffff"] },
          { name: "Real Sociedat", short: "RSO", city: "San Sebastián", strength: 0.74, colors: ["#0067b1", "#ffffff"] },
          { name: "Villareal", short: "VIL", city: "Villarreal", strength: 0.72, colors: ["#fde100", "#005187"] },
          { name: "Real Betix", short: "BET", city: "Sevilla", strength: 0.70, colors: ["#00954c", "#ffffff"] },
          { name: "Sevilya FC", short: "SEV", city: "Sevilla", strength: 0.68, colors: ["#ffffff", "#d4011d"] },
          { name: "Valenza", short: "VAL", city: "Valencia", strength: 0.66, colors: ["#ffffff", "#f18e00"] },
          { name: "Girono", short: "GIR", city: "Girona", strength: 0.65, colors: ["#d4011d", "#ffffff"] },
          { name: "Celto Vigo", short: "CEL", city: "Vigo", strength: 0.58, colors: ["#8ac3ee", "#ffffff"] },
          { name: "Osasoena", short: "OSA", city: "Pamplona", strength: 0.56, colors: ["#0a346f", "#d4011d"] },
          { name: "Getafa", short: "GET", city: "Getafe", strength: 0.55, colors: ["#005999", "#ffffff"] },
          { name: "Rayo Vallecana", short: "RAY", city: "Madrid", strength: 0.53, colors: ["#ffffff", "#e53027"] },
          { name: "Mallorco", short: "MLL", city: "Palma", strength: 0.52, colors: ["#e30613", "#000000"] },
          { name: "Leganez", short: "LEG", city: "Leganés", strength: 0.48, colors: ["#005bac", "#ffffff"] },
        ],
      },
      {
        name: "Liga Esp 2",
        tier: 2,
        promotion: 3,
        relegation: 0,
        clubs: [
          { name: "Esponyol", short: "ESP", city: "Barcelona", strength: 0.56, colors: ["#007fc8", "#d4011d"] },
          { name: "Real Vallodolid", short: "VLL", city: "Valladolid", strength: 0.54, colors: ["#921c7a", "#ffffff"] },
          { name: "Deportiva Coruna", short: "DEP", city: "A Coruña", strength: 0.53, colors: ["#0067b1", "#ffffff"] },
          { name: "Sporting Gijonn", short: "SPG", city: "Gijón", strength: 0.52, colors: ["#d4011d", "#ffffff"] },
          { name: "Real Zaragosa", short: "ZAR", city: "Zaragoza", strength: 0.51, colors: ["#005bac", "#ffffff"] },
          { name: "Levanta", short: "LEV", city: "Valencia", strength: 0.50, colors: ["#8a1538", "#005bac"] },
          { name: "Almeria UD", short: "ALM", city: "Almería", strength: 0.49, colors: ["#d4011d", "#ffffff"] },
          { name: "Granado CF", short: "GRA", city: "Granada", strength: 0.48, colors: ["#d4011d", "#ffffff"] },
          { name: "Cadyz", short: "CAD", city: "Cádiz", strength: 0.47, colors: ["#fde100", "#005bac"] },
          { name: "Malaga CF", short: "MAL", city: "Málaga", strength: 0.46, colors: ["#005bac", "#ffffff"] },
          { name: "Racing Santandar", short: "RAC", city: "Santander", strength: 0.45, colors: ["#00954c", "#ffffff"] },
          { name: "Oviedra", short: "OVI", city: "Oviedo", strength: 0.44, colors: ["#005bac", "#ffffff"] },
          { name: "Huesco", short: "HUE", city: "Huesca", strength: 0.43, colors: ["#005bac", "#d4011d"] },
          { name: "Elcha CF", short: "ELC", city: "Elche", strength: 0.42, colors: ["#00954c", "#ffffff"] },
          { name: "Burgas CF", short: "BUR", city: "Burgos", strength: 0.41, colors: ["#000000", "#ffffff"] },
          { name: "Eldenze", short: "ELD", city: "Elda", strength: 0.39, colors: ["#005bac", "#d4011d"] },
        ],
      },
    ],
  },
  {
    code: "NED",
    name: "Nederland",
    divisions: [
      {
        name: "Eredivisus",
        tier: 1,
        promotion: 0,
        relegation: 3,
        clubs: [
          { name: "Ajacks", short: "AJA", city: "Amsterdam", strength: 0.84, colors: ["#ffffff", "#d2122e"] },
          { name: "PXV Eindhoven", short: "PXV", city: "Eindhoven", strength: 0.86, colors: ["#ed1c24", "#ffffff"] },
          { name: "Feyenoard", short: "FEY", city: "Rotterdam", strength: 0.85, colors: ["#e30613", "#ffffff"] },
          { name: "AZ Alkmar", short: "AZA", city: "Alkmaar", strength: 0.72, colors: ["#e30613", "#ffffff"] },
          { name: "Twentje", short: "TWE", city: "Enschede", strength: 0.70, colors: ["#e30613", "#ffffff"] },
          { name: "Utrechd", short: "UTR", city: "Utrecht", strength: 0.66, colors: ["#e30613", "#ffffff"] },
          { name: "Spartoo Rotterdam", short: "SPA", city: "Rotterdam", strength: 0.58, colors: ["#e30613", "#ffffff"] },
          { name: "Heerenveem", short: "HEE", city: "Heerenveen", strength: 0.60, colors: ["#005ca9", "#ffffff"] },
          { name: "Vitessa", short: "VIT", city: "Arnhem", strength: 0.55, colors: ["#fff200", "#000000"] },
          { name: "Go Ahead Eagels", short: "GAE", city: "Deventer", strength: 0.54, colors: ["#e30613", "#fff200"] },
          { name: "NEC Nijmegan", short: "NEC", city: "Nijmegen", strength: 0.56, colors: ["#e30613", "#00963f"] },
          { name: "Sittard Forton", short: "FSI", city: "Sittard", strength: 0.50, colors: ["#fff200", "#00963f"] },
          { name: "Heraclus", short: "HER", city: "Almelo", strength: 0.49, colors: ["#000000", "#ffffff"] },
          { name: "PEX Zwolle", short: "PEX", city: "Zwolle", strength: 0.48, colors: ["#005ca9", "#ffffff"] },
          { name: "Wagening Groningen", short: "GRO", city: "Groningen", strength: 0.52, colors: ["#00963f", "#ffffff"] },
          { name: "Willim II", short: "WIL", city: "Tilburg", strength: 0.47, colors: ["#e30613", "#005ca9"] },
        ],
      },
      {
        name: "Eerste Divisus",
        tier: 2,
        promotion: 3,
        relegation: 0,
        clubs: [
          { name: "Den Haag ADU", short: "ADO", city: "Den Haag", strength: 0.52, colors: ["#fff200", "#00963f"] },
          { name: "Roda JK", short: "ROD", city: "Kerkrade", strength: 0.51, colors: ["#fff200", "#000000"] },
          { name: "De Graafschop", short: "GRA", city: "Doetinchem", strength: 0.50, colors: ["#005ca9", "#ffffff"] },
          { name: "Eindhovan FC", short: "FCE", city: "Eindhoven", strength: 0.49, colors: ["#005ca9", "#e30613"] },
          { name: "Volendamm", short: "VOL", city: "Volendam", strength: 0.48, colors: ["#e30613", "#ffffff"] },
          { name: "Cambuur Leeuward", short: "CAM", city: "Leeuwarden", strength: 0.50, colors: ["#fff200", "#005ca9"] },
          { name: "Helmond Sportu", short: "HEL", city: "Helmond", strength: 0.45, colors: ["#e30613", "#000000"] },
          { name: "MVV Maastrycht", short: "MVV", city: "Maastricht", strength: 0.46, colors: ["#e30613", "#ffffff"] },
          { name: "VVV Venloo", short: "VVV", city: "Venlo", strength: 0.47, colors: ["#fff200", "#000000"] },
          { name: "Excelsiar", short: "EXC", city: "Rotterdam", strength: 0.46, colors: ["#e30613", "#000000"] },
          { name: "Den Bosh", short: "FDB", city: "Den Bosch", strength: 0.44, colors: ["#005ca9", "#fff200"] },
          { name: "Telstor", short: "TEL", city: "Velsen", strength: 0.43, colors: ["#ffffff", "#005ca9"] },
          { name: "Dordrechd", short: "DOR", city: "Dordrecht", strength: 0.42, colors: ["#00963f", "#ffffff"] },
          { name: "Emmen FC", short: "EMM", city: "Emmen", strength: 0.45, colors: ["#e30613", "#ffffff"] },
          { name: "Oss TOP", short: "OSS", city: "Oss", strength: 0.40, colors: ["#e30613", "#000000"] },
          { name: "Jong Utrechd", short: "JUT", city: "Utrecht", strength: 0.39, colors: ["#e30613", "#000000"] },
        ],
      },
    ],
  },
];
