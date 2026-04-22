/**
 * i18n.js — Internationalization module with English and Arabic support
 */

const translations = {
  en: {
    // Header
    appName: 'خرائط غرفة العمليات العسكرية',
    online: 'Online',
    offline: 'Offline',
    onlineTitle: 'Online — Map tiles will load',
    offlineTitle: 'Offline — Using cached data',
    dropPinMode: 'Drop Pin Mode',
    toggleView: 'Toggle Satellite/Street View',
    toggleLabels: 'Toggle Street Names & Labels',
    switchLang: 'العربية',
    offlineModeToggle: 'Offline Mode',
    selectAreaBtn: 'Download Offline Area',
    
    // Sidebar
    myPins: 'My Pins',
    searchPins: 'Search pins...',
    noPinsYet: 'No pins yet',
    noPinsHint: 'Click the pin icon in the header or click anywhere on the map to drop a pin',
    exportShare: 'Export & Share',
    importData: 'Import Data',
    
    // Pin Mode Banner
    clickToDropPin: 'Click on the map to drop a pin',
    cancel: 'Cancel',
    
    // Pin Modal
    pinDetails: 'Pin Details',
    newPin: 'New Pin',
    editPin: 'Edit',
    name: 'Name',
    enterPinName: 'Enter pin name...',
    description: 'Description',
    addDescription: 'Add a description...',
    coordinates: 'Coordinates',
    videos: 'Videos',
    clickOrDrag: 'Click or drag video files here',
    videoFormats: 'MP4, WebM, MOV — No size limit',
    uploading: 'Uploading...',
    deletePin: 'Delete Pin',
    savePin: 'Save Pin',
    unnamedPin: 'Unnamed Pin',
    iconType: 'Marker Icon',
    defaultPin: 'Default Pin',
    car: 'Car',
    person: 'Person',
    drone: 'Drone',
    customPng: 'Custom PNG...',
    color: 'Color',
    folder: 'Folder',
    lineWidth: 'Line Width',
    newFolder: 'Enter Folder Name:',
    
    // Video Modal
    video: 'Video',
    
    // Export Modal
    exportingData: 'Exporting Data...',
    packagingPins: 'Packaging pins and videos...',
    
    // Download Modal
    downloadArea: 'Download Area',
    downloadAreaDesc: 'Select the maximum zoom depth to download. Higher zoom levels consume significantly more storage.',
    maxZoomLevel: 'Max Zoom Level',
    lowest: 'Lowest',
    highest: 'Highest',
    downloadAllZooms: 'Download All Zooms (5 to Max)',
    estimatedTiles: 'Estimated Tiles:',
    calculating: 'Calculating...',
    cancelDownload: 'Cancel',
    downloadTiles: 'Download',
    downloadingTiles: 'Downloading...',
    searchCityPlaceholder: 'Search City (e.g. Tripoli, Libya)',
    searchBtn: 'Search',
    addMarker: 'Add Marker',
    addRoute: 'Add Route',
    addZone: 'Add Zone',
    wirelessSync: 'Wireless LAN Sync',
    syncDesc: 'Connect another device to this exact Local Area Network (Wi-Fi) to seamlessly send and receive maps and pins entirely offline.',
    localAddress: 'Your Device Network ID',
    hostData: 'Host Data',
    targetIp: 'e.g. 192.168.1.15',
    pullData: 'Pull Data',
    
    // Toasts
    pinDropped: 'Pin dropped! Click "Open" to add details & videos.',
    pinSaved: 'Pin saved!',
    pinDeleted: 'Pin deleted.',
    streetView: 'Street view',
    satelliteView: 'Satellite view',
    labelsOn: 'Labels On',
    labelsOff: 'Labels Off',
    offlineModeOn: 'Offline mode enabled',
    offlineModeOff: 'Offline mode disabled (Online)',
    selectAreaStart: 'Draw an area or search for a city to download.',
    selectAreaEnd: 'Click again to define the second corner',
    areaSelected: 'Area selected.',
    cityNotFound: 'City not found on OpenStreetMap.',
    downloadComplete: 'Download complete!',
    downloadFailed: 'Download failed: ',
    downloadCancelled: 'Download cancelled.',
    videoAdded: 'video(s) added!',
    videoRemoved: 'Video removed.',
    noPin: 'No pin selected!',
    dropVideoOnly: 'Please drop video files only.',
    exportComplete: 'Export complete!',
    exportFailed: 'Export failed: ',
    importFailed: 'Import failed: ',
    importingData: 'Importing data...',
    invalidFile: 'Invalid .pinvault file',
    
    // Popups
    open: 'Open',
    delete: 'Delete',
    
    // Confirm
    confirmDelete: 'Delete this pin and all its videos?',
    
    // Misc
    uploaded: 'Uploaded',
    generating: 'Generating file...',
    exported: 'Exported',
    imported: 'Imported',
    pinsAndVideos: 'pins & videos!',
    packagingVideo: 'Packaging video',
    manageLibrary: 'Tactical Library',
    libraryDesc: 'Permanently add custom tactical units to your primary icon list. Supports SVG and PNG.',
    libIconName: 'Unit Name (e.g. Tank Platoon)',
    uploadIcon: 'Upload',
    addToLibrary: 'Add to Library',
    currentLibrary: 'Current Library',
    printMap: 'Print Map',
    protectedData: 'Protected Tactical Data',
    privacyWarning: 'Security lock active while window is hidden.',
    printSettings: 'Print Settings',
    paperSize: 'Paper Size',
    orientation: 'Orientation',
    printNow: 'Print Now',
    preparingPrint: 'Preparing map for print...',
    screenshotDetected: 'Screenshots of tactical data are restricted.',
    confirmExit: 'تأكيد الخروج',
    confirmExitDesc: 'هل تريد حفظ جميع البيانات وإغلاق البرنامج؟',
    exitApp: 'خروج',
    savingData: 'جاري حفظ البيانات... إيقاف التشغيل.',
    // Auth
    authSubtitle: 'Military Operations Room',
    createAccount: 'Create New Account',
    operatorName: 'Operator Name',
    rankPosition: 'Rank / Position',
    password: 'Password',
    confirmPassword: 'Confirm Password',
    createAndEnter: 'Create & Enter',
    enter: 'Enter',
    welcomeBack: 'Welcome back',
    passwordMismatch: 'Passwords do not match',
    passwordTooShort: 'Password too short (min 4 chars)',
    wrongPassword: 'Wrong password',
    accountLocked: 'Account locked',
    // LOS
    losTitle: 'Line of Sight',
    losClickObserver: 'Click to set observer position',
    losClickTarget: 'Click to set target position',
    losAnalyzing: 'Analyzing line of sight...',
    losClear: 'Clear line of sight',
    losBlocked: 'Line of sight blocked',
    losObstacles: 'obstacle(s)',
    losResult: 'Line of Sight Result',
    losNoData: 'No terrain data available for this area',
    losClearAll: 'Clear',
    observer: 'Observer',
    target: 'Target',
    distance: 'Distance',
    bearing: 'Bearing',
    // Tactical Tools
    tacticalTools: 'Tactical Tools',
    iconLibrary: 'Icon Library',
    measureTool: 'Measure',
    circleTool: 'Circle',
    liveMeasurement: 'Live Measurement',
    clearActive: 'Clear',
    pinToMap: 'Pin to Map',
    circleSettings: 'Circle Settings',
    diameter: 'Diameter (meters)',
    colorLabel: 'Color',
    losWithBuildings: 'Urban LOS (with buildings)',
    spyglass: 'Tactical Spyglass',
    spyglassHint: 'Move cursor to reveal street labels. Ctrl+Scroll to resize.',
    // Kill Box
    killboxTool: 'Kill Box',
    killboxTitle: 'Kill Box Grid Settings',
    killboxGridName: 'Grid Name',
    killboxCols: 'Columns (Numbers)',
    killboxRows: 'Rows (Letters)',
    killboxColor: 'Color',
    killboxOpacity: 'Opacity',
    killboxCreate: 'Create Grid',
    killboxHint: 'Click the first corner of the kill box',
    killboxSecondCorner: 'Click the second (diagonal) corner',
    killboxRemove: 'Remove Grid',
    killboxRemoved: 'Grid removed',
    killboxCells: 'cells',
    killboxAllCleared: 'All grids cleared',
    // Night Ops
    nightOps: 'Night Ops Mode',
    nightOpsRed: 'Night Ops — Red Filter',
    nightOpsGreen: 'Night Ops — NVG Green',
    nightOpsOff: 'Night Ops Disabled',
    // Azimuth
    azimuthTool: 'Compass',
    azimuthTitle: 'Tactical Compass',
    azimuthHint: 'Click to set observer position',
    azimuthAim: 'Move mouse to aim, click to lock bearing',
    compass: 'Compass',
    backAzimuth: 'Back Azimuth',
    azimuthClear: 'Clear Lines',
    azimuthDone: 'Done',
    azimuthCleared: 'Azimuth lines cleared',
    azimuthDeleteHint: 'Right-click a line to delete | Shift+Click',
    azimuthClearAll: 'Clear All',
    azimuthReset: 'Move Center',
    azimuthResetHint: 'Click to set new observer position',
    azimuthAllCleared: 'All lines and center cleared',
    azimuthLineDeleted: 'Line deleted',
    // Mortar FCS
    mortarTool: 'Mortar',
    mortarTitle: 'Mortar Fire Control System',
    mortarHint: 'Click to place mortar baseplate',
    mortarBaseplate: 'Mortar Baseplate',
    mortarPlaced: 'Baseplate placed — click targets',
    mortarMinRange: 'Min Range',
    mortarMaxRange: 'Max Range',
    mortarTooClose: '⚠️ DANGER CLOSE!',
    mortarTooFar: '⚠️ OUT OF RANGE',
    mortarInRange: '✅ In Range',
    mortarCharge: 'Charge',
    mortarElevation: 'Elevation',
    mortarClickTarget: 'Click map to designate targets',
    mortarClearAll: 'Clear All',
    mortarAllCleared: 'All data cleared',
    mortarMilChanged: 'Mil system updated',
    // Freehand
    freehandTool: 'Freehand',
    freehandTitle: 'Freehand Drawing',
    freehandHint: 'Press and drag to draw',
    freehandFree: 'Free',
    freehandArrow: 'Attack Arrow',
    freehandWidth: 'Width',
    freehandDrawn: 'Drawn',
    freehandDeleted: 'Drawing deleted',
    freehandClearAll: 'Clear All',
    freehandAllCleared: 'All drawings cleared',
    freehandDeleteHint: 'Right-click a drawing to delete',
    // Range Rings
    ringTool: 'Ranges',
    ringTitle: 'Range Rings',
    ringHint: 'Click to place range center',
    ringPreset: 'Type',
    ringDeleted: 'Range rings deleted',
    ringAllCleared: 'All range rings cleared',
    // MGRS
    mgrsTool: 'MGRS',
    mgrsHint: 'Move cursor for coordinates — Click to pin',
    mgrsCoords: 'Coordinates',
    mgrsClean: 'Clear',
    close: 'Close',
  },
  ar: {
    // Header
    appName: 'خرائط غرفة العمليات العسكرية',
    online: 'متصل',
    offline: 'غير متصل',
    onlineTitle: 'متصل — سيتم تحميل خرائط البلاط',
    offlineTitle: 'غير متصل — استخدام البيانات المخزنة',
    dropPinMode: 'وضع إسقاط الدبوس',
    toggleView: 'تبديل عرض القمر الصناعي/الشارع',
    toggleLabels: 'إظهار/إخفاء أسماء الشوارع',
    switchLang: 'English',
    offlineModeToggle: 'وضع عدم الاتصال',
    selectAreaBtn: 'تحميل منطقة للخريطة',
    
    // Sidebar
    myPins: 'دبابيسي',
    searchPins: 'البحث في الدبابيس...',
    noPinsYet: 'لا توجد دبابيس بعد',
    noPinsHint: 'انقر على أيقونة الدبوس في الرأس أو انقر في أي مكان على الخريطة لإسقاط دبوس',
    exportShare: 'تصدير ومشاركة',
    importData: 'استيراد البيانات',
    
    // Pin Mode Banner
    clickToDropPin: 'انقر على الخريطة لإسقاط دبوس',
    cancel: 'إلغاء',
    
    // Pin Modal
    pinDetails: 'تفاصيل الدبوس',
    newPin: 'دبوس جديد',
    editPin: 'تعديل',
    name: 'الاسم',
    enterPinName: 'أدخل اسم الدبوس...',
    description: 'الوصف',
    addDescription: 'أضف وصفاً...',
    coordinates: 'الإحداثيات',
    videos: 'الفيديوهات',
    clickOrDrag: 'انقر أو اسحب ملفات الفيديو هنا',
    videoFormats: 'MP4, WebM, MOV — بدون حد للحجم',
    uploading: 'جاري الرفع...',
    deletePin: 'حذف الدبوس',
    savePin: 'حفظ الدبوس',
    unnamedPin: 'دبوس بدون اسم',
    iconType: 'أيقونة المؤشر',
    defaultPin: 'دبوس افتراضي',
    car: 'سيارة',
    person: 'شخص',
    drone: 'طائرة بدون طيار',
    customPng: 'صورة مخصصة...',
    color: 'اللون',
    folder: 'مجلد',
    lineWidth: 'عرض الخط',
    newFolder: 'أدخل اسم المجلد:',
    
    // Video Modal
    video: 'فيديو',
    
    // Export Modal
    exportingData: 'جاري التصدير...',
    packagingPins: 'تجميع الدبابيس والفيديوهات...',
    
    // Download Modal
    downloadArea: 'تحميل المنطقة',
    downloadAreaDesc: 'حدد أقصى مستوى تقريب للتحميل. مستويات التقريب العالية تستهلك مساحة تخزين أكبر بكثير.',
    maxZoomLevel: 'أقصى مستوى تقريب',
    lowest: 'الأدنى',
    highest: 'الأعلى',
    downloadAllZooms: 'تحميل جميع مستويات التقريب (5 إلى الحد الأقصى)',
    estimatedTiles: 'البلاطات المقدرة:',
    calculating: 'جاري الحساب...',
    cancelDownload: 'إلغاء',
    downloadTiles: 'تحميل',
    downloadingTiles: 'جاري التحميل...',
    searchCityPlaceholder: 'البحث عن مدينة (مثل طرابلس، ليبيا)',
    searchBtn: 'بحث',
    addMarker: 'إضافة مؤشر',
    addRoute: 'إضافة مسار',
    addZone: 'إضافة منطقة',
    wirelessSync: 'المزامنة اللاسلكية',
    syncDesc: 'قم بتوصيل جهاز آخر بنفس الشبكة المحلية المتصل بها (Wi-Fi) لإرسال واستقبال الخرائط والدبابيس بسلاسة تامة بدون إنترنت.',
    localAddress: 'عنوان الشبكة الخاص بجهازك',
    hostData: 'استضافة البيانات',
    targetIp: 'مثال: 192.168.1.15',
    pullData: 'سحب البيانات',
    
    // Toasts
    pinDropped: 'تم إسقاط الدبوس! انقر "فتح" لإضافة التفاصيل والفيديوهات.',
    pinSaved: 'تم حفظ الدبوس!',
    pinDeleted: 'تم حذف الدبوس.',
    streetView: 'عرض الشارع',
    satelliteView: 'عرض القمر الصناعي',
    labelsOn: 'الأسماء مفعّلة',
    labelsOff: 'الأسماء معطّلة',
    offlineModeOn: 'تم تفعيل وضع عدم الاتصال',
    offlineModeOff: 'تم إيقاف وضع عدم الاتصال (متصل)',
    selectAreaStart: 'ارسم منطقة على الخريطة أو ابحث عن مدينة.',
    selectAreaEnd: 'انقر مرة أخرى لتحديد الزاوية الثانية',
    areaSelected: 'تم تحديد المنطقة.',
    cityNotFound: 'لم يتم العثور على المدينة في الخرائط.',
    downloadComplete: 'اكتمل التحميل!',
    downloadFailed: 'فشل التحميل: ',
    downloadCancelled: 'تم إلغاء التحميل.',
    videoAdded: 'فيديو(هات) تمت إضافتها!',
    videoRemoved: 'تم حذف الفيديو.',
    noPin: 'لم يتم اختيار دبوس!',
    dropVideoOnly: 'يرجى إسقاط ملفات الفيديو فقط.',
    exportComplete: 'اكتمل التصدير!',
    exportFailed: 'فشل التصدير: ',
    importFailed: 'فشل الاستيراد: ',
    importingData: 'جاري استيراد البيانات...',
    invalidFile: 'ملف .pinvault غير صالح',
    
    // Popups
    open: 'فتح',
    delete: 'حذف',
    
    // Confirm
    confirmDelete: 'هل تريد حذف هذا الدبوس وجميع فيديوهاته؟',
    
    // Misc
    uploaded: 'تم الرفع',
    generating: 'جاري إنشاء الملف...',
    exported: 'تم تصدير',
    imported: 'تم استيراد',
    pinsAndVideos: 'دبابيس وفيديوهات!',
    packagingVideo: 'تجميع فيديو',
    manageLibrary: 'مكتبة التكتيكات',
    libraryDesc: 'أضف وحدات تكتيكية مخصصة بشكل دائم إلى قائمة الأيقونات الرئيسية الخاصة بك. يدعم SVG و PNG.',
    libIconName: 'اسم الوحدة (مثلاً: فصيلة دبابات)',
    uploadIcon: 'رفع',
    addToLibrary: 'إضافة إلى المكتبة',
    currentLibrary: 'المكتبة الحالية',
    printMap: 'طباعة الخريطة',
    protectedData: 'بيانات تكتيكية محمية',
    privacyWarning: 'قفل الأمان نشط أثناء إخفاء النافذة.',
    printSettings: 'إعدادات الطباعة',
    paperSize: 'حجم الورق',
    orientation: 'الاتجاه',
    printNow: 'اطبع الآن',
    preparingPrint: 'جاري تجهيز الخريطة للطباعة...',
    screenshotDetected: 'لقطات الشاشة للبيانات التكتيكية مقيدة.',
    confirmExit: 'تأكيد الخروج',
    confirmExitDesc: 'هل تريد حفظ جميع البيانات وإغلاق البرنامج؟',
    exitApp: 'خروج',
    savingData: 'جاري حفظ البيانات... إيقاف التشغيل.',
    // Auth
    authSubtitle: 'غرفة العمليات العسكرية',
    createAccount: 'إنشاء حساب جديد',
    operatorName: 'اسم المشغل',
    rankPosition: 'الرتبة / المنصب',
    password: 'كلمة المرور',
    confirmPassword: 'تأكيد كلمة المرور',
    createAndEnter: 'إنشاء والدخول',
    enter: 'دخول',
    welcomeBack: 'مرحباً',
    passwordMismatch: 'كلمات المرور غير متطابقة',
    passwordTooShort: 'كلمة المرور قصيرة (4 أحرف على الأقل)',
    wrongPassword: 'كلمة المرور خاطئة',
    accountLocked: 'الحساب مقفل',
    // LOS
    losTitle: 'خط النظر',
    losClickObserver: 'انقر لتحديد موقع المراقب',
    losClickTarget: 'انقر لتحيد موقع الهدف',
    losAnalyzing: 'جاري تحليل خط النظر...',
    losClear: 'رؤية واضحة',
    losBlocked: 'رؤية محجوبة',
    losObstacles: 'عائق',
    losResult: 'نتيجة خط النظر',
    losNoData: 'بيانات التضاريس غير متوفرة لهذه المنطقة',
    losClearAll: 'مسح',
    observer: 'المراقب',
    target: 'الهدف',
    distance: 'المسافة',
    bearing: 'الاتجاه',
    // Tactical Tools
    tacticalTools: 'أدوات تكتيكية',
    iconLibrary: 'مكتبة الأيقونات',
    measureTool: 'قياس',
    circleTool: 'دائرة',
    liveMeasurement: 'قياس مباشر',
    clearActive: 'مسح',
    pinToMap: 'تثبيت على الخريطة',
    circleSettings: 'إعدادات الدائرة',
    diameter: 'القطر (متر)',
    colorLabel: 'اللون',
    losWithBuildings: 'خط نظر مدني (مع المباني)',
    spyglass: 'عدسة التجسس',
    spyglassHint: 'حرك المؤشر لكشف أسماء الشوارع. Ctrl+سكرول لتغيير الحجم.',
    // Kill Box
    killboxTool: 'منطقة القتل',
    killboxTitle: 'إعدادات شبكة منطقة القتل',
    killboxGridName: 'اسم الشبكة',
    killboxCols: 'أعمدة (أرقام)',
    killboxRows: 'صفوف (أحرف)',
    killboxColor: 'اللون',
    killboxOpacity: 'الشفافية',
    killboxCreate: 'إنشاء الشبكة',
    killboxHint: 'انقر على الزاوية الأولى لشبكة القتل',
    killboxSecondCorner: 'انقر على الزاوية الثانية (القطرية)',
    killboxRemove: 'حذف الشبكة',
    killboxRemoved: 'تم حذف الشبكة',
    killboxCells: 'خلية',
    killboxAllCleared: 'تم مسح جميع الشبكات',
    // Night Ops
    nightOps: 'الوضع الليلي التكتيكي',
    nightOpsRed: 'وضع ليلي — فلتر أحمر',
    nightOpsGreen: 'وضع ليلي — رؤية ليلية خضراء',
    nightOpsOff: 'الوضع الليلي معطل',
    // Azimuth
    azimuthTool: 'بوصلة',
    azimuthTitle: 'البوصلة التكتيكية',
    azimuthHint: 'انقر لتحديد موقع المراقب',
    azimuthAim: 'حرك الماوس لتحديد الاتجاه ثم انقر للتثبيت',
    compass: 'البوصلة',
    backAzimuth: 'الاتجاه العكسي',
    azimuthClear: 'مسح الخطوط',
    azimuthDone: 'إنهاء',
    azimuthCleared: 'تم مسح خطوط الاتجاه',
    azimuthDeleteHint: 'كليك يمين على خط لحذفه | Shift+كليك',
    azimuthClearAll: 'مسح الكل',
    azimuthReset: 'نقل المركز',
    azimuthResetHint: 'انقر لتحديد موقع مراقب جديد',
    azimuthAllCleared: 'تم مسح كل الخطوط والمركز',
    azimuthLineDeleted: 'تم حذف الخط',
    // Mortar FCS
    mortarTool: 'هاون',
    mortarTitle: 'نظام إدارة نار الهاون',
    mortarHint: 'انقر لوضع قاعدة الهاون',
    mortarBaseplate: 'قاعدة الهاون',
    mortarPlaced: 'قاعدة الهاون موضوعة — انقر الأهداف',
    mortarMinRange: 'الحد الأدنى',
    mortarMaxRange: 'المدى الأقصى',
    mortarTooClose: '⚠️ خطر! قريب جداً',
    mortarTooFar: '⚠️ خارج المدى',
    mortarInRange: '✅ في المدى',
    mortarCharge: 'الشحنة',
    mortarElevation: 'زاوية الرمي',
    mortarClickTarget: 'انقر على الخريطة لتحديد الأهداف',
    mortarClearAll: 'مسح الكل',
    mortarAllCleared: 'تم مسح كل البيانات',
    mortarMilChanged: 'نظام المل محدث',
    // Freehand
    freehandTool: 'رسم حر',
    freehandTitle: 'الرسم الحر',
    freehandHint: 'اضغط واسحب للرسم الحر',
    freehandFree: 'حر',
    freehandArrow: 'سهم هجوم',
    freehandWidth: 'السمك',
    freehandDrawn: 'تم الرسم',
    freehandDeleted: 'تم حذف الرسم',
    freehandClearAll: 'مسح الكل',
    freehandAllCleared: 'تم مسح كل الرسومات',
    freehandDeleteHint: 'كليك يمين على رسم لحذفه',
    // Range Rings
    ringTool: 'نطاقات',
    ringTitle: 'دوائر النطاق',
    ringHint: 'انقر لوضع مركز النطاقات',
    ringPreset: 'النوع',
    ringDeleted: 'تم حذف النطاقات',
    ringAllCleared: 'تم مسح كل النطاقات',
    // MGRS
    mgrsTool: 'MGRS',
    mgrsHint: 'حرك المؤشر لعرض الإحداثيات — انقر للتثبيت',
    mgrsCoords: 'الإحداثيات',
    mgrsClean: 'مسح',
    close: 'إغلاق',
  }
};

let currentLang = localStorage.getItem('pinvault-lang') || 'en';

export function t(key) {
  return translations[currentLang]?.[key] || translations['en'][key] || key;
}

export function getLang() {
  return currentLang;
}

export function setLang(lang) {
  currentLang = lang;
  localStorage.setItem('pinvault-lang', lang);
  
  // Update HTML dir and lang attributes
  const html = document.documentElement;
  if (html) {
    if (lang === 'ar') {
      html.setAttribute('dir', 'rtl');
      html.setAttribute('lang', 'ar');
    } else {
      html.setAttribute('dir', 'ltr');
      html.setAttribute('lang', 'en');
    }
  }

  if (document.body) {
    if (lang === 'ar') {
      document.body.classList.add('rtl');
    } else {
      document.body.classList.remove('rtl');
    }
  }
}

export function toggleLang() {
  const newLang = currentLang === 'en' ? 'ar' : 'en';
  setLang(newLang);
  return newLang;
}

// Initialize direction on load
export function initLang() {
  setLang(currentLang);
}
