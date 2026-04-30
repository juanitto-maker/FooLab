// Source strings (English) + language list. This is the only translation
// payload shipped to the browser — every other language is fetched from
// /api/translate on demand and cached in localStorage. Same architecture
// as Sacred Verse, rewritten in vanilla JS.
//
// Bump TRANSLATION_VERSION whenever sourceStrings change so old caches
// invalidate and missing keys get re-translated.

export const TRANSLATION_VERSION = 1;

// Sacred Verse language list — major global + European + other major
// world languages. 'countryCode' maps to https://flagcdn.com.
export const languages = [
  // Major Global Languages
  { code: 'en', name: 'English',           countryCode: 'gb', englishName: 'English' },
  { code: 'es', name: 'Español',           countryCode: 'es', englishName: 'Spanish' },
  { code: 'fr', name: 'Français',          countryCode: 'fr', englishName: 'French' },
  { code: 'de', name: 'Deutsch',           countryCode: 'de', englishName: 'German' },
  { code: 'pt', name: 'Português',         countryCode: 'br', englishName: 'Portuguese' },
  { code: 'it', name: 'Italiano',          countryCode: 'it', englishName: 'Italian' },
  { code: 'ru', name: 'Русский',           countryCode: 'ru', englishName: 'Russian' },
  { code: 'ja', name: '日本語',             countryCode: 'jp', englishName: 'Japanese' },
  { code: 'zh', name: '中文',               countryCode: 'cn', englishName: 'Chinese (Simplified)' },
  { code: 'ar', name: 'العربية',           countryCode: 'sa', englishName: 'Arabic' },
  { code: 'hi', name: 'हिन्दी',              countryCode: 'in', englishName: 'Hindi' },
  { code: 'ko', name: '한국어',             countryCode: 'kr', englishName: 'Korean' },

  // European Languages
  { code: 'nl', name: 'Nederlands',        countryCode: 'nl', englishName: 'Dutch' },
  { code: 'pl', name: 'Polski',            countryCode: 'pl', englishName: 'Polish' },
  { code: 'sv', name: 'Svenska',           countryCode: 'se', englishName: 'Swedish' },
  { code: 'no', name: 'Norsk',             countryCode: 'no', englishName: 'Norwegian' },
  { code: 'da', name: 'Dansk',             countryCode: 'dk', englishName: 'Danish' },
  { code: 'fi', name: 'Suomi',             countryCode: 'fi', englishName: 'Finnish' },
  { code: 'cs', name: 'Čeština',           countryCode: 'cz', englishName: 'Czech' },
  { code: 'sk', name: 'Slovenčina',        countryCode: 'sk', englishName: 'Slovak' },
  { code: 'hu', name: 'Magyar',            countryCode: 'hu', englishName: 'Hungarian' },
  { code: 'ro', name: 'Română',            countryCode: 'ro', englishName: 'Romanian' },
  { code: 'bg', name: 'Български',         countryCode: 'bg', englishName: 'Bulgarian' },
  { code: 'hr', name: 'Hrvatski',          countryCode: 'hr', englishName: 'Croatian' },
  { code: 'sr', name: 'Српски',            countryCode: 'rs', englishName: 'Serbian' },
  { code: 'sl', name: 'Slovenščina',       countryCode: 'si', englishName: 'Slovenian' },
  { code: 'et', name: 'Eesti',             countryCode: 'ee', englishName: 'Estonian' },
  { code: 'lv', name: 'Latviešu',          countryCode: 'lv', englishName: 'Latvian' },
  { code: 'lt', name: 'Lietuvių',          countryCode: 'lt', englishName: 'Lithuanian' },
  { code: 'el', name: 'Ελληνικά',          countryCode: 'gr', englishName: 'Greek' },
  { code: 'mt', name: 'Malti',             countryCode: 'mt', englishName: 'Maltese' },
  { code: 'ga', name: 'Gaeilge',           countryCode: 'ie', englishName: 'Irish' },
  { code: 'cy', name: 'Cymraeg',           countryCode: 'gb-wls', englishName: 'Welsh' },

  // Other Major World Languages
  { code: 'bn', name: 'বাংলা',              countryCode: 'bd', englishName: 'Bengali' },
  { code: 'ur', name: 'اردو',              countryCode: 'pk', englishName: 'Urdu' },
  { code: 'fa', name: 'فارسی',             countryCode: 'ir', englishName: 'Persian' },
  { code: 'tr', name: 'Türkçe',            countryCode: 'tr', englishName: 'Turkish' },
  { code: 'he', name: 'עברית',             countryCode: 'il', englishName: 'Hebrew' },
  { code: 'th', name: 'ไทย',               countryCode: 'th', englishName: 'Thai' },
  { code: 'vi', name: 'Tiếng Việt',        countryCode: 'vn', englishName: 'Vietnamese' },
  { code: 'id', name: 'Bahasa Indonesia',  countryCode: 'id', englishName: 'Indonesian' },
  { code: 'ms', name: 'Bahasa Melayu',     countryCode: 'my', englishName: 'Malay' },
  { code: 'tl', name: 'Filipino',          countryCode: 'ph', englishName: 'Filipino (Tagalog)' },
  { code: 'sw', name: 'Kiswahili',         countryCode: 'ke', englishName: 'Swahili' },
  { code: 'am', name: 'አማርኛ',              countryCode: 'et', englishName: 'Amharic' },
  { code: 'yo', name: 'Yorùbá',            countryCode: 'ng', englishName: 'Yoruba' },
  { code: 'ig', name: 'Igbo',              countryCode: 'ng', englishName: 'Igbo' },
  { code: 'ha', name: 'Hausa',             countryCode: 'ng', englishName: 'Hausa' }
];

// RTL languages — set <html dir="rtl"> when active.
export const RTL_CODES = new Set(['ar', 'he', 'fa', 'ur']);

// Single source of truth for every translatable string in the app. Keep
// keys stable: cached translations key off them.
export const sourceStrings = {
  // Brand / topbar
  brandTag: 'food label scanner',
  pageTitle: 'FooLab — food label scanner',
  selectLanguage: 'Select language',
  appActions: 'App actions',
  archiveAria: 'Open archive',
  archiveTitle: 'Archive',
  shareAppAria: 'Share FooLab',
  shareAppTitle: 'Share',
  installAria: 'Install app',
  installTitle: 'Install',
  aboutAria: 'About FooLab',
  aboutTitle: 'About',

  // Scan screen
  heroTitle: "Know what's inside",
  heroSub: 'Snap a label, get a NutriScore grade and red-flag alerts in seconds.',
  scanLabelBtn: 'Scan a label',
  chooseGalleryBtn: 'Choose from gallery',
  catalogCtaTitle: 'Search the public catalog first',
  catalogCtaSub: "Other shoppers may have already scanned this product. Scan only if you can't find it here.",
  featureNutriscoreTitle: 'NutriScore A–E',
  featureNutriscoreSub: 'Grade + 0–100 score',
  featureRedflagsTitle: 'Red-flag alerts',
  featureRedflagsSub: 'Palm oil, E-numbers, sugar',
  featurePrivateTitle: 'Private by default',
  featurePrivateSub: 'Archive on-device · catalog is opt-in',
  tipsHeading: 'How to scan well',
  tipsLead: 'Take three photos for the best card:',
  tipsItem1Strong: 'The whole product',
  tipsItem1Rest: ' — front of pack, used as the catalog thumbnail.',
  tipsItem2Strong: 'The ingredients list',
  tipsItem2Rest: ' — close-up, sharp text, fill the frame.',
  tipsItem3Strong: 'The nutrition table',
  tipsItem3Rest: ' — for an accurate NutriScore.',
  tipsFoot: 'Bright, even light. Hold steady. Tap to focus until the text is sharp.',

  // Crop screen
  back: '← Back',
  addPhoto: '+ Add photo',
  analyze: 'Analyze →',
  photoMeta: 'Photo {n} of {total}',

  // Analyzing
  analyzingTip1: 'Reading ingredients…',
  analyzingTip2: 'Checking E-numbers…',
  analyzingTip3: 'Counting the sugar…',
  analyzingTip4: 'Grading the NutriScore…',
  analyzingTip5: 'Looking for red flags…',
  translating: 'Translating…',

  // Result screen
  publishToggleTitle: 'Let the world know about your finding',
  publishToggleSub: 'Adds this card to the public catalog so other shoppers can find it.',
  save: 'Save',
  share: 'Share',
  rescan: 'Rescan',

  // Archive
  archiveHeading: 'Archive',
  archiveEmpty: 'No scans yet. Try your first one.',
  delete: 'Delete',
  detailBack: '← Archive',
  confirmDeleteScan: 'Delete this scan?',

  // Catalog
  catalogHeading: 'Public catalog',
  catalogTabAll: 'All',
  catalogTabFood: 'Food',
  catalogTabDrinks: 'Drinks',
  catalogSearchPlaceholder: 'Search by product or brand…',
  catalogSearchFoodPlaceholder: 'Search foods…',
  catalogSearchDrinkPlaceholder: 'Search drinks…',
  catalogFilters: 'Filters',
  catalogKeep: 'Keep',
  catalogAvoid: 'Avoid',
  catalogSort: 'Sort',
  catalogSortRecent: 'Recent',
  catalogSortPopular: 'Popular',
  catalogSortBest: 'Best score',
  catalogEmpty: 'No products yet. Be the first — scan something.',
  catalogLoadMore: 'Load more',
  catalogBack: '← Catalog',
  catalogProductsCount: '{n} products',
  catalogProductCount: '{n} product',
  catalogScannedTimes: 'Scanned {n} times',
  catalogRegion: 'Region: {region}',

  // Red flags / avoid chips
  flagPalmOil: 'Palm oil',
  flagTransFat: 'Trans fat',
  flagHighSugar: 'High sugar',
  flagHighSalt: 'High salt',
  flagHighSatFat: 'High sat fat',
  flagArtificialColor: 'Artificial color',
  flagArtificialColorShort: 'Artif. color',
  flagPreservative: 'Preservative',
  flagSweetener: 'Sweetener',
  flagMsg: 'MSG',
  flagBhaBht: 'BHA/BHT',
  flagUltraProcessed: 'Ultra-processed',
  flagUltraProcessedShort: 'Ultra-proc.',
  flagAllergen: 'Allergen',

  // Scorecard
  unknownProduct: 'Unknown product',
  healthScore: 'Health score',
  healthScoreOf100: '{score} / 100',
  sectionHeadsUp: 'Heads-up for',
  sectionRedFlags: 'Red flags',
  sectionEnumbers: 'E-numbers / additives',
  sectionIngredients: 'Ingredients',
  sectionNutritionPer: 'Nutrition (per {per})',
  sectionAllergens: 'Allergens',
  sectionTips: 'Tips',
  confidenceBadge: 'Confidence: {level}',
  confidenceLow: 'low',
  confidenceMedium: 'medium',
  confidenceHigh: 'high',
  enumberAbout: 'About',
  enumberSmallDose: 'Small amounts',
  enumberLargeDose: 'Daily / heavy use',
  enumberConsumption: 'Consumption',
  enumberRelevantFor: 'Relevant for',
  unreadableTitle: 'Could not read the label',
  unreadableMessage: 'Try a closer, better-lit photo.',

  // Nutrition rows
  nutrEnergy: 'Energy',
  nutrSugar: 'Sugar',
  nutrSatFat: 'Sat fat',
  nutrSalt: 'Salt',
  nutrFiber: 'Fiber',
  nutrProtein: 'Protein',

  // Conditions
  condDiabetes: 'Diabetes',
  condHypertension: 'Hypertension',
  condHypotension: 'Low blood pressure',
  condPku: 'PKU',
  condSulfite: 'Sulfite sensitivity',
  condAdhdChildren: 'ADHD-sensitive children',
  condKidney: 'Kidney disease',
  condThyroid: 'Thyroid',
  condIbs: 'IBS / sensitive gut',
  condMigraine: 'Migraine-prone',

  // About
  aboutHeading: 'About FooLab',
  aboutP1: 'FooLab reads food and drink labels with AI and gives you a NutriScore grade plus red-flag alerts — palm oil, artificial colors, controversial additives, high sugar or salt.',
  aboutP2Strong: 'Privacy:',
  aboutP2Rest: ' your scan archive lives only on this phone. The photo you capture is sent to the AI for analysis and discarded after.',
  aboutP3Strong: 'Public catalog:',
  aboutP3Rest: ' when you save a scan, you can tick "Let the world know about your finding" to add the card and a square thumbnail to the shared catalog so other shoppers can find the product. The toggle defaults on but you can switch it off for any scan, or every scan, and nothing leaves your phone beyond the AI analysis.',
  aboutP4Strong: 'Not medical advice.',
  aboutP4Rest: ' Use alongside your own judgement and any dietary guidance from your doctor.',
  aboutFooter: 'v0.1 · NutriScore method:',

  // Card export footer
  cardFooter: 'Scanned with FooLab',

  // Toasts / errors
  toastShareLinkCopied: 'Link copied to clipboard.',
  toastShareUnsupported: 'Sharing not supported on this device.',
  toastInstalled: 'FooLab installed. Find it on your home screen.',
  toastMaxPhotos: 'Max 3 photos. Remove one first.',
  toastTakePhotoFirst: 'Take a photo first.',
  toastAnalysisFailed: 'Analysis failed.',
  toastSavedToArchive: 'Saved to archive.',
  toastSavingPublishing: 'Saved. Publishing to catalog…',
  toastSharedToCatalog: 'Saved to archive and shared with the catalog.',
  toastCatalogIncremented: 'Saved. Existing catalog entry got a +1.',
  toastCatalogPublishFailed: 'Saved locally — publishing to catalog failed.',
  toastCouldNotProcess: 'Could not process photo.',
  toastCouldNotSave: 'Could not save.',
  toastCouldNotOpenArchive: 'Could not open archive.',
  toastCouldNotDelete: 'Could not delete.',
  toastCouldNotShare: 'Could not share.',
  toastCouldNotLoadCatalog: 'Could not load catalog.',
  toastScanNotFound: 'Scan not found.',
  toastCouldNotLoadProduct: 'Could not load product.',
  toastSomethingWentWrong: 'Something went wrong. Please try again.',
  toastTranslateOverloaded: 'Translation is busy right now — try another language or come back later.',
  toastTranslateTimeout: 'Translation took too long — your network may be slow. Try again.',
  toastTranslateNotConfigured: 'Translation is not configured on this server (missing GEMINI_API_KEY).'
};
