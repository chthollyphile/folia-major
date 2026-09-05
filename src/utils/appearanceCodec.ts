import {
    DEFAULT_CLADDAGH_TUNING,
    DEFAULT_DIORAMA_TUNING,
    DEFAULT_LATENT_BACKGROUND_TUNING,
    DEFAULT_MONET_BACKGROUND_TUNING,
    DEFAULT_MONET_TUNING,
    DEFAULT_NOMAND_BACKGROUND_TUNING,
    DEFAULT_PENDOLO_TUNING,
    DEFAULT_SONNET_TUNING,
    DEFAULT_TEMPERA_TUNING,
    type DualTheme,
    type Theme,
} from '../types';

// src/utils/appearanceCodec.ts
// The shareable appearance config codec: theme + visual settings <-> the minified `folia-theme://`
// shortcode carried by config codes and by the OBS URL's cfg param. Lifted out of the settings
// subview so the OBS URL builder and the overlay parser can read it without importing a React
// component. Keep it a leaf: no store, no services, no components.

export const compressTheme = (t: Theme): any => ({
    n: t.name,
    bg: t.backgroundColor,
    pc: t.primaryColor,
    ac: t.accentColor,
    sc: t.secondaryColor,
    tfs: t.fontStyle,
    tff: t.fontFamily,
    ai: t.animationIntensity,
    wc: t.wordColors,
    li: t.lyricsIcons,
    pv: t.provider,
    tds: t.description,
});

export const decompressTheme = (o: any): Theme => ({
    name: o.n || 'Imported Theme',
    backgroundColor: o.bg || '#000000',
    primaryColor: o.pc || '#ffffff',
    accentColor: o.ac || '#ffffff',
    secondaryColor: o.sc || '#888888',
    fontStyle: o.tfs || 'sans',
    fontFamily: o.tff,
    animationIntensity: o.ai || 'normal',
    wordColors: o.wc || [],
    lyricsIcons: o.li || [],
    provider: o.pv,
    description: o.tds || '',
});

const compressClassic = (t: any): any => ({
    ewr: t.enableWordRotation,
    bfm: t.breathingFloatMultiplier,
    ull: t.useLegacyLayout,
    cws: t.wordSpacing,
});
const decompressClassic = (o: any): any => ({
    enableWordRotation: o.ewr !== undefined ? o.ewr : true,
    breathingFloatMultiplier: o.bfm !== undefined ? o.bfm : 1,
    useLegacyLayout: o.ull,
    wordSpacing: o.cws,
});

const compressCadenza = (t: any): any => ({
    cfs: t.fontScale,
    wr: t.widthRatio,
    ma: t.motionAmount,
    gi: t.glowIntensity,
    bi: t.beamIntensity,
});
const decompressCadenza = (o: any): any => ({
    fontScale: o.cfs !== undefined ? o.cfs : 1.12,
    widthRatio: o.wr !== undefined ? o.wr : 0.72,
    motionAmount: o.ma !== undefined ? o.ma : 1,
    glowIntensity: o.gi !== undefined ? o.gi : 1,
    beamIntensity: o.bi !== undefined ? o.bi : 0,
});

const compressPartita = (t: any): any => ({
    sgl: t.showGuideLines,
    usl: t.useSemanticLayout,
    smi: t.staggerMin,
    sma: t.staggerMax,
});
const decompressPartita = (o: any): any => ({
    showGuideLines: o.sgl !== undefined ? o.sgl : true,
    useSemanticLayout: o.usl !== undefined ? o.usl : true,
    staggerMin: o.smi !== undefined ? o.smi : 20,
    staggerMax: o.sma !== undefined ? o.sma : 100,
});

const compressFume = (t: any): any => ({
    hps: t.hidePrintSymbols,
    dgb: t.disableGeometricBackground,
    boo: t.backgroundObjectOpacity,
    thr: t.textHoldRatio,
    ctm: t.cameraTrackingMode,
    csp: t.cameraSpeed,
    gi: t.glowIntensity,
    hs: t.heroScale,
});
const decompressFume = (o: any): any => ({
    hidePrintSymbols: o.hps !== undefined ? o.hps : false,
    disableGeometricBackground: o.dgb !== undefined ? o.dgb : true,
    backgroundObjectOpacity: o.boo !== undefined ? o.boo : 0.5,
    textHoldRatio: o.thr !== undefined ? o.thr : 1,
    cameraTrackingMode: o.ctm || 'smooth',
    cameraSpeed: o.csp !== undefined ? o.csp : 1,
    glowIntensity: o.gi !== undefined ? o.gi : 1,
    heroScale: o.hs !== undefined ? o.hs : 1,
});

const compressCladdagh = (t: any): any => ({
    fsr: t.focusScaleRatio,
    rs: t.radiusScale,
    etd: t.ellipseTiltDeg,
});
const decompressCladdagh = (o: any): any => ({
    focusScaleRatio: o.fsr !== undefined ? o.fsr : DEFAULT_CLADDAGH_TUNING.focusScaleRatio,
    radiusScale: o.rs !== undefined ? o.rs : DEFAULT_CLADDAGH_TUNING.radiusScale,
    ellipseTiltDeg: o.etd !== undefined ? o.etd : DEFAULT_CLADDAGH_TUNING.ellipseTiltDeg,
});

const compressCappella = (t: any): any => ({
    sem: t.showEmoMessages,
    eps: t.emojiPackSource,
    as: t.avatarSource,
});
const decompressCappella = (o: any): any => ({
    showEmoMessages: o.sem !== undefined ? o.sem : true,
    emojiPackSource: o.eps || 'builtin',
    avatarSource: o.as || 'cover',
});

const compressTilt = (t: any): any => ({
    sp: t.splitProbability,
    tsp: t.tiltStyleProbability,
    tcs: t.colorScheme,
});
const decompressTilt = (o: any): any => ({
    splitProbability: o.sp !== undefined ? o.sp : 0.75,
    tiltStyleProbability: o.tsp !== undefined ? o.tsp : 0.35,
    colorScheme: o.tcs || 'default',
});

const compressDiorama = (t: any): any => ({
    cs: t.cameraSpeed,
    ma: t.motionAmount,
    ar: t.audioReactivity,
    gv: t.geometryVisibility ? {
        e: t.geometryVisibility.enabled,
        m: t.geometryVisibility.mode,
        s: t.geometryVisibility.strands,
        b: t.geometryVisibility.blobs,
        r: t.geometryVisibility.ribbons,
        o: t.geometryVisibility.rings,
    } : undefined,
    pd: t.particleDensity,
        psz: t.particleScale,
    pge: t.particleGlowEnabled,
    pgi: t.particleGlowIntensity,
    spa: t.showParticles,
    bpc: t.backgroundParticleCircumference,
    bpr: t.backgroundParticleRadial,
    ge: t.glowEnabled,
    gi: t.glowIntensity,
    se: t.soulEnabled,
    si: t.soulIntensity,
    sae: t.soulActiveEnabled,
    gre: t.gradientEnabled,
    gri: t.gradientIntensity,
    kce: t.keywordColoringEnabled,
});
const decompressDiorama = (o: any): any => ({
    cameraSpeed: o.cs !== undefined ? o.cs : DEFAULT_DIORAMA_TUNING.cameraSpeed,
    motionAmount: o.ma !== undefined ? o.ma : DEFAULT_DIORAMA_TUNING.motionAmount,
    audioReactivity: o.ar !== undefined ? o.ar : DEFAULT_DIORAMA_TUNING.audioReactivity,
    geometryVisibility: {
        enabled: o.gv?.e !== undefined ? o.gv.e : DEFAULT_DIORAMA_TUNING.geometryVisibility.enabled,
        mode: o.gv?.m !== undefined ? o.gv.m : DEFAULT_DIORAMA_TUNING.geometryVisibility.mode,
        strands: o.gv?.s !== undefined ? o.gv.s : DEFAULT_DIORAMA_TUNING.geometryVisibility.strands,
        blobs: o.gv?.b !== undefined ? o.gv.b : DEFAULT_DIORAMA_TUNING.geometryVisibility.blobs,
        ribbons: o.gv?.r !== undefined ? o.gv.r : DEFAULT_DIORAMA_TUNING.geometryVisibility.ribbons,
        rings: o.gv?.o !== undefined ? o.gv.o : DEFAULT_DIORAMA_TUNING.geometryVisibility.rings,
    },
    particleDensity: o.pd !== undefined ? o.pd : DEFAULT_DIORAMA_TUNING.particleDensity,
        particleScale: o.psz !== undefined ? o.psz : DEFAULT_DIORAMA_TUNING.particleScale,
    particleGlowEnabled: o.pge !== undefined ? o.pge : DEFAULT_DIORAMA_TUNING.particleGlowEnabled,
    particleGlowIntensity: o.pgi !== undefined ? o.pgi : DEFAULT_DIORAMA_TUNING.particleGlowIntensity,
    showParticles: o.spa !== undefined ? o.spa : DEFAULT_DIORAMA_TUNING.showParticles,
    backgroundParticleCircumference: o.bpc !== undefined ? o.bpc : DEFAULT_DIORAMA_TUNING.backgroundParticleCircumference,
    backgroundParticleRadial: o.bpr !== undefined ? o.bpr : DEFAULT_DIORAMA_TUNING.backgroundParticleRadial,
    glowEnabled: o.ge !== undefined ? o.ge : DEFAULT_DIORAMA_TUNING.glowEnabled,
    glowIntensity: o.gi !== undefined ? o.gi : DEFAULT_DIORAMA_TUNING.glowIntensity,
    soulEnabled: o.se !== undefined ? o.se : DEFAULT_DIORAMA_TUNING.soulEnabled,
    soulIntensity: o.si !== undefined ? o.si : DEFAULT_DIORAMA_TUNING.soulIntensity,
    soulActiveEnabled: o.sae !== undefined ? o.sae : DEFAULT_DIORAMA_TUNING.soulActiveEnabled,
    gradientEnabled: o.gre !== undefined ? o.gre : DEFAULT_DIORAMA_TUNING.gradientEnabled,
    gradientIntensity: o.gri !== undefined ? o.gri : DEFAULT_DIORAMA_TUNING.gradientIntensity,
    keywordColoringEnabled: o.kce !== undefined ? o.kce : DEFAULT_DIORAMA_TUNING.keywordColoringEnabled,
});

const compressMonetBackground = (t: any): any => ({
    mbs: t.backgroundSource,
    mbl: t.backgroundLayout,
    mbb: t.backgroundBlurPx,
    mbo: t.backgroundOverlayOpacity,
    mbg: t.backgroundGrayscale,
    mbsat: t.backgroundSaturation,
    mbw: t.backgroundWash,
    mbh: t.backgroundHalfPaneOffsetX,
    mbwcm: t.backgroundWashColorMode,
    mbwcc: t.backgroundWashCustomColor,
    mbde: t.backgroundDriftEnabled,
    mbds: t.backgroundDriftStrength,
    mbse: t.backgroundStreaksEnabled,
});
const decompressMonetBackground = (o: any): any => ({
    backgroundSource: o.mbs || DEFAULT_MONET_BACKGROUND_TUNING.backgroundSource,
    backgroundLayout: o.mbl || DEFAULT_MONET_BACKGROUND_TUNING.backgroundLayout,
    backgroundBlurPx: o.mbb !== undefined ? o.mbb : DEFAULT_MONET_BACKGROUND_TUNING.backgroundBlurPx,
    backgroundOverlayOpacity: o.mbo !== undefined ? o.mbo : DEFAULT_MONET_BACKGROUND_TUNING.backgroundOverlayOpacity,
    backgroundGrayscale: o.mbg !== undefined ? o.mbg : DEFAULT_MONET_BACKGROUND_TUNING.backgroundGrayscale,
    backgroundSaturation: o.mbsat !== undefined ? o.mbsat : DEFAULT_MONET_BACKGROUND_TUNING.backgroundSaturation,
    backgroundWash: o.mbw !== undefined ? o.mbw : DEFAULT_MONET_BACKGROUND_TUNING.backgroundWash,
    backgroundHalfPaneOffsetX: o.mbh !== undefined ? o.mbh : DEFAULT_MONET_BACKGROUND_TUNING.backgroundHalfPaneOffsetX,
    backgroundWashColorMode: o.mbwcm || DEFAULT_MONET_BACKGROUND_TUNING.backgroundWashColorMode,
    backgroundWashCustomColor: o.mbwcc || DEFAULT_MONET_BACKGROUND_TUNING.backgroundWashCustomColor,
    backgroundDriftEnabled: o.mbde !== undefined ? o.mbde : DEFAULT_MONET_BACKGROUND_TUNING.backgroundDriftEnabled,
    backgroundDriftStrength: o.mbds !== undefined ? o.mbds : DEFAULT_MONET_BACKGROUND_TUNING.backgroundDriftStrength,
    backgroundStreaksEnabled: o.mbse !== undefined ? o.mbse : DEFAULT_MONET_BACKGROUND_TUNING.backgroundStreaksEnabled,
});

const compressNomandBackground = (t: any): any => ({
    is: t.imageSource,
    ...(t.effect !== undefined ? { e: t.effect } : {}),
    dt: t.ditheringType,
    s: t.size,
    cs: t.colorSteps,
    oc: t.originalColors,
    i: t.inverted,
    ...(t.flutedGlassSize !== undefined ? { fgs: t.flutedGlassSize } : {}),
    ...(t.flutedGlassDistortion !== undefined ? { fgd: t.flutedGlassDistortion } : {}),
    ...(t.flutedGlassBlur !== undefined ? { fgb: t.flutedGlassBlur } : {}),
    ...(t.paperTextureContrast !== undefined ? { ptc: t.paperTextureContrast } : {}),
    ...(t.paperTextureRoughness !== undefined ? { ptr: t.paperTextureRoughness } : {}),
    ...(t.paperTextureFiber !== undefined ? { ptf: t.paperTextureFiber } : {}),
    ...(t.halftoneDotsSize !== undefined ? { hds: t.halftoneDotsSize } : {}),
    ...(t.halftoneDotsRadius !== undefined ? { hdr: t.halftoneDotsRadius } : {}),
    ...(t.halftoneDotsContrast !== undefined ? { hdc: t.halftoneDotsContrast } : {}),
    ...(t.halftoneDotsOriginalColors !== undefined ? { hdoc: t.halftoneDotsOriginalColors } : {}),
    ...(t.halftoneDotsInverted !== undefined ? { hdi: t.halftoneDotsInverted } : {}),
    ...(t.lensDistortionSpread !== undefined ? { lds: t.lensDistortionSpread } : {}),
    ...(t.lensDistortionBulge !== undefined ? { ldb: t.lensDistortionBulge } : {}),
    ...(t.lensDistortionDispersion !== undefined ? { ldd: t.lensDistortionDispersion } : {}),
    oe: t.overlayEnabled,
    oo: t.overlayOpacity,
});
const decompressNomandBackground = (o: any): any => ({
    imageSource: o.is || DEFAULT_NOMAND_BACKGROUND_TUNING.imageSource,
    ...(o.e !== undefined ? { effect: o.e } : {}),
    ditheringType: o.dt === '2x2' || o.dt === '4x4' || o.dt === '8x8'
        ? o.dt
        : DEFAULT_NOMAND_BACKGROUND_TUNING.ditheringType,
    size: o.s !== undefined ? o.s : DEFAULT_NOMAND_BACKGROUND_TUNING.size,
    colorSteps: o.cs !== undefined ? o.cs : DEFAULT_NOMAND_BACKGROUND_TUNING.colorSteps,
    originalColors: o.oc !== undefined ? o.oc : DEFAULT_NOMAND_BACKGROUND_TUNING.originalColors,
    inverted: o.i !== undefined ? o.i : DEFAULT_NOMAND_BACKGROUND_TUNING.inverted,
    ...(o.fgs !== undefined ? { flutedGlassSize: o.fgs } : {}),
    ...(o.fgd !== undefined ? { flutedGlassDistortion: o.fgd } : {}),
    ...(o.fgb !== undefined ? { flutedGlassBlur: o.fgb } : {}),
    ...(o.ptc !== undefined ? { paperTextureContrast: o.ptc } : {}),
    ...(o.ptr !== undefined ? { paperTextureRoughness: o.ptr } : {}),
    ...(o.ptf !== undefined ? { paperTextureFiber: o.ptf } : {}),
    ...(o.hds !== undefined ? { halftoneDotsSize: o.hds } : {}),
    ...(o.hdr !== undefined ? { halftoneDotsRadius: o.hdr } : {}),
    ...(o.hdc !== undefined ? { halftoneDotsContrast: o.hdc } : {}),
    ...(o.hdoc !== undefined ? { halftoneDotsOriginalColors: o.hdoc } : {}),
    ...(o.hdi !== undefined ? { halftoneDotsInverted: o.hdi } : {}),
    ...(o.lds !== undefined ? { lensDistortionSpread: o.lds } : {}),
    ...(o.ldb !== undefined ? { lensDistortionBulge: o.ldb } : {}),
    ...(o.ldd !== undefined ? { lensDistortionDispersion: o.ldd } : {}),
    overlayEnabled: o.oe !== undefined ? o.oe : DEFAULT_NOMAND_BACKGROUND_TUNING.overlayEnabled,
    overlayOpacity: o.oo !== undefined ? o.oo : DEFAULT_NOMAND_BACKGROUND_TUNING.overlayOpacity,
});

const compressLatentBackground = (t: any): any => ({
    dm: t.displayMode,
    cs: t.colorSource,
    dopv: t.dynamicOnlyInPlayer,
    ebr: t.enhancedBeatResponse,
    ds: t.ditheringSpeed,
    das: t.ditheringAudioSpeed,
    dz: t.ditheringSize,
    dop: t.ditheringOpacity,
    ms: t.meshSpeed,
    mas: t.meshAudioSpeed,
    md: t.meshDistortion,
    mw: t.meshSwirl,
    oe: t.overlayEnabled,
    oo: t.overlayOpacity,
});
const decompressLatentBackground = (o: any): any => ({
    displayMode: o.dm || DEFAULT_LATENT_BACKGROUND_TUNING.displayMode,
    colorSource: o.cs || DEFAULT_LATENT_BACKGROUND_TUNING.colorSource,
    dynamicOnlyInPlayer: o.dopv !== undefined
        ? o.dopv
        : DEFAULT_LATENT_BACKGROUND_TUNING.dynamicOnlyInPlayer,
    enhancedBeatResponse: o.ebr !== undefined
        ? o.ebr
        : DEFAULT_LATENT_BACKGROUND_TUNING.enhancedBeatResponse,
    ditheringSpeed: o.ds !== undefined ? o.ds : DEFAULT_LATENT_BACKGROUND_TUNING.ditheringSpeed,
    ditheringAudioSpeed: o.das !== undefined ? o.das : DEFAULT_LATENT_BACKGROUND_TUNING.ditheringAudioSpeed,
    ditheringSize: o.dz !== undefined ? o.dz : DEFAULT_LATENT_BACKGROUND_TUNING.ditheringSize,
    ditheringOpacity: o.dop !== undefined ? o.dop : DEFAULT_LATENT_BACKGROUND_TUNING.ditheringOpacity,
    meshSpeed: o.ms !== undefined ? o.ms : DEFAULT_LATENT_BACKGROUND_TUNING.meshSpeed,
    meshAudioSpeed: o.mas !== undefined ? o.mas : DEFAULT_LATENT_BACKGROUND_TUNING.meshAudioSpeed,
    meshDistortion: o.md !== undefined ? o.md : DEFAULT_LATENT_BACKGROUND_TUNING.meshDistortion,
    meshSwirl: o.mw !== undefined ? o.mw : DEFAULT_LATENT_BACKGROUND_TUNING.meshSwirl,
    overlayEnabled: o.oe !== undefined ? o.oe : DEFAULT_LATENT_BACKGROUND_TUNING.overlayEnabled,
    overlayOpacity: o.oo !== undefined ? o.oo : DEFAULT_LATENT_BACKGROUND_TUNING.overlayOpacity,
});

const compressMonet = (t: any): any => ({
    kce: t.keywordColoringEnabled,
    msd: t.showDescription,
    mas: t.audioStyle,
    mfs: t.fontScale,
    mps: t.portraitSource,
    pox: t.portraitOffsetX,
    mpy: t.portraitStyle,
    mpdh: t.showPortraitDragHanger,
});
const decompressMonet = (o: any): any => ({
    keywordColoringEnabled: o.kce !== undefined ? o.kce : DEFAULT_MONET_TUNING.keywordColoringEnabled,
    showDescription: o.msd !== undefined ? o.msd : DEFAULT_MONET_TUNING.showDescription,
    audioStyle: o.mas || DEFAULT_MONET_TUNING.audioStyle,
    fontScale: o.mfs !== undefined ? o.mfs : DEFAULT_MONET_TUNING.fontScale,
    portraitSource: o.mps || DEFAULT_MONET_TUNING.portraitSource,
    portraitOffsetX: o.pox !== undefined ? o.pox : DEFAULT_MONET_TUNING.portraitOffsetX,
    portraitStyle: o.mpy || DEFAULT_MONET_TUNING.portraitStyle,
    showPortraitDragHanger: o.mpdh !== undefined ? o.mpdh : DEFAULT_MONET_TUNING.showPortraitDragHanger,
});

const compressPendolo = (t: any): any => ({
    sgd: t.showGearDecor,
    scg: t.showCenterGradient,
    sco: t.showCoverOnWatchFace,
    elg: t.enableLineGlow,
});
const decompressPendolo = (o: any): any => ({
    showGearDecor: o.sgd || DEFAULT_PENDOLO_TUNING.showGearDecor,
    showCenterGradient: o.scg !== undefined ? o.scg : DEFAULT_PENDOLO_TUNING.showCenterGradient,
    showCoverOnWatchFace: o.sco !== undefined ? o.sco : DEFAULT_PENDOLO_TUNING.showCoverOnWatchFace,
    enableLineGlow: o.elg !== undefined ? o.elg : DEFAULT_PENDOLO_TUNING.enableLineGlow,
});

const compressSonnet = (t: any): any => ({
    ci: t.cameraIntensity,
    tm: t.typographyMotion,
    md: t.mgDensity,
    sot: t.showOnlyText,
    sg: t.showGuide,
    sbm: t.showBackgroundMg,
    sfg: t.showFixedGeo,
    sgdt: t.showGiantDecorativeText,
    sbd: t.showBackgroundDecor,
    et: t.enableTransitions,
    ofm: t.outerFrameMode,
    tr: t.textureResolution,
    ppe: t.postProcessEnabled,
    ppg: t.postProcessGrain,
    ppc: t.postProcessContrast,
    ppr: t.postProcessRgbShift,
    pph: t.postProcessHalftone,
    ppv: t.postProcessVignette,
    ppld: t.postProcessLensDistortion,
    pplx: t.postProcessLensDispersion,
});
const decompressSonnet = (o: any): any => ({
    cameraIntensity: o.ci !== undefined ? o.ci : DEFAULT_SONNET_TUNING.cameraIntensity,
    typographyMotion: o.tm !== undefined ? o.tm : DEFAULT_SONNET_TUNING.typographyMotion,
    mgDensity: o.md !== undefined ? o.md : DEFAULT_SONNET_TUNING.mgDensity,
    showOnlyText: o.sot !== undefined ? o.sot : DEFAULT_SONNET_TUNING.showOnlyText,
    showGuide: o.sg !== undefined ? o.sg : DEFAULT_SONNET_TUNING.showGuide,
    showBackgroundMg: o.sbm !== undefined ? o.sbm : DEFAULT_SONNET_TUNING.showBackgroundMg,
    showFixedGeo: o.sfg !== undefined ? o.sfg : DEFAULT_SONNET_TUNING.showFixedGeo,
    showGiantDecorativeText: o.sgdt !== undefined ? o.sgdt : DEFAULT_SONNET_TUNING.showGiantDecorativeText,
    showBackgroundDecor: o.sbd !== undefined ? o.sbd : DEFAULT_SONNET_TUNING.showBackgroundDecor,
    enableTransitions: o.et !== undefined ? o.et : DEFAULT_SONNET_TUNING.enableTransitions,
    outerFrameMode: o.ofm !== undefined ? o.ofm : DEFAULT_SONNET_TUNING.outerFrameMode,
    textureResolution: o.tr !== undefined ? o.tr : DEFAULT_SONNET_TUNING.textureResolution,
    postProcessEnabled: o.ppe !== undefined ? o.ppe : DEFAULT_SONNET_TUNING.postProcessEnabled,
    postProcessGrain: o.ppg !== undefined ? o.ppg : DEFAULT_SONNET_TUNING.postProcessGrain,
    postProcessContrast: o.ppc !== undefined ? o.ppc : DEFAULT_SONNET_TUNING.postProcessContrast,
    postProcessRgbShift: o.ppr !== undefined ? o.ppr : DEFAULT_SONNET_TUNING.postProcessRgbShift,
    postProcessHalftone: o.pph !== undefined ? o.pph : DEFAULT_SONNET_TUNING.postProcessHalftone,
    postProcessVignette: o.ppv !== undefined ? o.ppv : DEFAULT_SONNET_TUNING.postProcessVignette,
    postProcessLensDistortion: o.ppld !== undefined ? o.ppld : DEFAULT_SONNET_TUNING.postProcessLensDistortion,
    postProcessLensDispersion: o.pplx !== undefined ? o.pplx : DEFAULT_SONNET_TUNING.postProcessLensDispersion,
});

const compressTempera = (t: any): any => ({
    ci: t.cameraIntensity,
    gm: t.glyphMotion,
    wll: t.wholeLineLyrics,
    gss: t.glyphSettleStretch,
    cm: t.colorMode,
    sb: t.showBlocks,
    sd: t.showDecor,
    ti: t.textInversion,
    li: t.layerImages,
    lid: t.layerImageDepth,
    lif: t.layerImageFrequency,
    et: t.enableTransitions,
    tr: t.textureResolution,
    ppe: t.postProcessEnabled,
    pptc: t.postProcessTextureCompression,
    ppg: t.postProcessGrain,
    ppc: t.postProcessContrast,
    ppr: t.postProcessRgbShift,
    ppv: t.postProcessVignette,
    ppld: t.postProcessLensDistortion,
});
const decompressTempera = (o: any): any => ({
    cameraIntensity: o.ci !== undefined ? o.ci : DEFAULT_TEMPERA_TUNING.cameraIntensity,
    glyphMotion: o.gm !== undefined ? o.gm : DEFAULT_TEMPERA_TUNING.glyphMotion,
    wholeLineLyrics: o.wll !== undefined ? o.wll : DEFAULT_TEMPERA_TUNING.wholeLineLyrics,
    glyphSettleStretch: o.gss !== undefined ? o.gss : DEFAULT_TEMPERA_TUNING.glyphSettleStretch,
    colorMode: o.cm !== undefined ? o.cm : DEFAULT_TEMPERA_TUNING.colorMode,
    showBlocks: o.sb !== undefined ? o.sb : DEFAULT_TEMPERA_TUNING.showBlocks,
    showDecor: o.sd !== undefined ? o.sd : DEFAULT_TEMPERA_TUNING.showDecor,
    textInversion: o.ti !== undefined ? o.ti : DEFAULT_TEMPERA_TUNING.textInversion,
    layerImages: o.li !== undefined ? o.li : DEFAULT_TEMPERA_TUNING.layerImages,
    layerImageDepth: o.lid !== undefined ? o.lid : DEFAULT_TEMPERA_TUNING.layerImageDepth,
    layerImageFrequency: o.lif !== undefined ? o.lif : DEFAULT_TEMPERA_TUNING.layerImageFrequency,
    enableTransitions: o.et !== undefined ? o.et : DEFAULT_TEMPERA_TUNING.enableTransitions,
    textureResolution: o.tr !== undefined ? o.tr : DEFAULT_TEMPERA_TUNING.textureResolution,
    postProcessEnabled: o.ppe !== undefined ? o.ppe : DEFAULT_TEMPERA_TUNING.postProcessEnabled,
    postProcessTextureCompression: o.pptc !== undefined
        ? o.pptc
        : DEFAULT_TEMPERA_TUNING.postProcessTextureCompression,
    postProcessGrain: o.ppg !== undefined ? o.ppg : DEFAULT_TEMPERA_TUNING.postProcessGrain,
    postProcessContrast: o.ppc !== undefined ? o.ppc : DEFAULT_TEMPERA_TUNING.postProcessContrast,
    postProcessRgbShift: o.ppr !== undefined ? o.ppr : DEFAULT_TEMPERA_TUNING.postProcessRgbShift,
    postProcessVignette: o.ppv !== undefined ? o.ppv : DEFAULT_TEMPERA_TUNING.postProcessVignette,
    postProcessLensDistortion: o.ppld !== undefined ? o.ppld : DEFAULT_TEMPERA_TUNING.postProcessLensDistortion,
});

export const compressConfig = (config: any): string => {
    const minified: any = {};
    if (config.theme) {
        minified.t = {
            l: compressTheme(config.theme.light),
            d: compressTheme(config.theme.dark),
        };
    }
    if (config.visualizerMode) minified.vm = config.visualizerMode;
    if (config.randomVisualizerModePerSong !== undefined) minified.rvms = config.randomVisualizerModePerSong;
    if (config.visualizerBackgroundMode) minified.vbm = config.visualizerBackgroundMode;
    if (config.backgroundOpacity !== undefined) minified.bo = config.backgroundOpacity;
    if (config.useCoverColorBg !== undefined) minified.ccb = config.useCoverColorBg;
    if (config.disableVisualizerGeometricBackground !== undefined) minified.dvgb = config.disableVisualizerGeometricBackground;
    if (config.disableVisualizerVignette !== undefined) minified.dvv = config.disableVisualizerVignette;
    if (config.staticMode !== undefined) minified.stm = config.staticMode;
    if (config.visualizerOpacity !== undefined) minified.vo = config.visualizerOpacity;
    if (config.hidePlayerTranslationSubtitle !== undefined) minified.hpts = config.hidePlayerTranslationSubtitle;
    if (config.showSubtitleTranslation !== undefined) minified.sst = config.showSubtitleTranslation;
    if (config.subtitleContentMode !== undefined) minified.scm = config.subtitleContentMode;
    if (config.subtitleOverlayBackground !== undefined) minified.sob = config.subtitleOverlayBackground;
    if (config.subtitleOverlayOpacity !== undefined) minified.soo = config.subtitleOverlayOpacity;
    if (config.showHarmonySubtitle !== undefined) minified.shs = config.showHarmonySubtitle;
    if (config.harmonySubtitleBackground !== undefined) minified.hsb = config.harmonySubtitleBackground;
    if (config.lyricsFontStyle) minified.lfs = config.lyricsFontStyle;
    if (config.lyricsFontScale !== undefined) minified.lfn = config.lyricsFontScale;
    if (config.lyricsFontWeight !== undefined) minified.lfw = config.lyricsFontWeight;
    if (config.lyricsFontFallbackFamilies?.length) minified.lff = config.lyricsFontFallbackFamilies;
    if (config.lyricsCustomFontFamily) minified.lcf = config.lyricsCustomFontFamily;
    if (config.subtitleFontInheritsLyrics !== undefined) minified.sfi = config.subtitleFontInheritsLyrics;
    if (config.subtitleFontScale !== undefined) minified.sfsz = config.subtitleFontScale;
    if (config.subtitleFontStyle) minified.sfs = config.subtitleFontStyle;
    if (config.subtitleFontWeight !== undefined) minified.sfw = config.subtitleFontWeight;
    if (config.subtitleFontFamily) minified.sff = config.subtitleFontFamily;
    if (config.subtitleFontFallbackFamilies?.length) minified.sfff = config.subtitleFontFallbackFamilies;

    if (config.visualizerTunings) minified.vt = config.visualizerTunings;
    if (config.classicTuning) minified.ct = compressClassic(config.classicTuning);
    if (config.cadenzaTuning) minified.cat = compressCadenza(config.cadenzaTuning);
    if (config.partitaTuning) minified.pt = compressPartita(config.partitaTuning);
    if (config.fumeTuning) minified.ft = compressFume(config.fumeTuning);
    if (config.claddaghTuning) minified.clt = compressCladdagh(config.claddaghTuning);
    if (config.cappellaTuning) minified.cpt = compressCappella(config.cappellaTuning);
    if (config.tiltTuning) minified.tt = compressTilt(config.tiltTuning);
    if (config.dioramaTuning) minified.dot = compressDiorama(config.dioramaTuning);
    if (config.monetBackgroundTuning) minified.mbt = compressMonetBackground(config.monetBackgroundTuning);
    if (config.nomandBackgroundTuning) minified.nbt = compressNomandBackground(config.nomandBackgroundTuning);
    if (config.latentBackgroundTuning) minified.lbt = compressLatentBackground(config.latentBackgroundTuning);
    if (config.monetTuning) minified.mt = compressMonet(config.monetTuning);
    if (config.pendoloTuning) minified.pdt = compressPendolo(config.pendoloTuning);
    if (config.sonnetTuning) minified.snt = compressSonnet(config.sonnetTuning);
    if (config.temperaTuning) minified.tmp = compressTempera(config.temperaTuning);
    if (config.urlBackgroundList) minified.ubl = config.urlBackgroundList;
    if (config.urlBackgroundSelectedId) minified.ubid = config.urlBackgroundSelectedId;
    if (config.songThemeAutoSwitchEnabled !== undefined) minified.stas = config.songThemeAutoSwitchEnabled;
    if (config.songThemeAutoGenerateEnabled !== undefined) minified.stag = config.songThemeAutoGenerateEnabled;
    if (config.themeGenerationSource !== undefined) minified.tgs = config.themeGenerationSource;
    if (config.followSystemTheme !== undefined) minified.fst = config.followSystemTheme;
    if (config.stageTrackPillMode !== undefined) minified.stp = config.stageTrackPillMode;
    if (config.stageTrackPillTimeoutSec !== undefined) minified.stpt = config.stageTrackPillTimeoutSec;
    if (config.stageTrackPillOnHome !== undefined) minified.stph = config.stageTrackPillOnHome;

    const jsonStr = JSON.stringify(minified);
    const bytes = new TextEncoder().encode(jsonStr);
    const binaryString = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
    const base64 = btoa(binaryString);
    return `folia-theme://${base64}`;
};

/**
 * Decodes and restores a configuration object from either raw JSON or a compressed base64 string starting with 'folia-theme://'.
 */
export const decompressConfig = (str: string): any => {
    let parsed: any = null;
    const trimmed = str.trim();
    const isCompressedShortcode = trimmed.startsWith('folia-theme://');
    if (isCompressedShortcode) {
        const base64 = trimmed.slice('folia-theme://'.length);
        const binaryString = atob(base64);
        const bytes = Uint8Array.from(binaryString, char => char.charCodeAt(0));
        const jsonStr = new TextDecoder().decode(bytes);
        parsed = JSON.parse(jsonStr);
    } else {
        parsed = JSON.parse(trimmed);
    }

    if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid format');
    }

    const isMinified = isCompressedShortcode
        || parsed.t !== undefined
        || parsed.vm !== undefined
        || parsed.rvms !== undefined
        || parsed.ccb !== undefined
        || parsed.dvgb !== undefined
        || parsed.dvv !== undefined
        || parsed.stm !== undefined
        || parsed.soo !== undefined
        || parsed.ct !== undefined
        || parsed.cat !== undefined
        || parsed.dot !== undefined
        || parsed.nbt !== undefined
        || parsed.lbt !== undefined
        || parsed.hpts !== undefined
        || parsed.sst !== undefined
        || parsed.sob !== undefined
        || parsed.shs !== undefined
        || parsed.hsb !== undefined
        || parsed.lfw !== undefined
        || parsed.sfw !== undefined
        || parsed.lff !== undefined
        || parsed.sfi !== undefined
        || parsed.pdt !== undefined
        || parsed.snt !== undefined
        || parsed.fst !== undefined
        // The now playing card's three keys. Listed like the rest so a hand-written JSON that only
        // carries the card is still recognised as the minified shape rather than falling through to
        // the long-name branch, where none of them is a valid key.
        || parsed.stp !== undefined
        || parsed.stpt !== undefined
        || parsed.stph !== undefined;
    if (isMinified) {
        const decompressed: any = {};
        if (parsed.t) {
            decompressed.theme = {
                light: decompressTheme(parsed.t.l),
                dark: decompressTheme(parsed.t.d),
            };
        }
        if (parsed.vm) decompressed.visualizerMode = parsed.vm;
        if (parsed.rvms !== undefined) decompressed.randomVisualizerModePerSong = parsed.rvms;
        if (parsed.vbm) decompressed.visualizerBackgroundMode = parsed.vbm;
        if (parsed.bo !== undefined) decompressed.backgroundOpacity = parsed.bo;
        if (parsed.ccb !== undefined) decompressed.useCoverColorBg = parsed.ccb;
        if (parsed.dvgb !== undefined) decompressed.disableVisualizerGeometricBackground = parsed.dvgb;
        if (parsed.dvv !== undefined) decompressed.disableVisualizerVignette = parsed.dvv;
        if (parsed.stm !== undefined) decompressed.staticMode = parsed.stm;
        if (parsed.vo !== undefined) decompressed.visualizerOpacity = parsed.vo;
        if (parsed.hpts !== undefined) decompressed.hidePlayerTranslationSubtitle = parsed.hpts;
        if (parsed.sst !== undefined) decompressed.showSubtitleTranslation = parsed.sst;
        if (parsed.scm !== undefined) decompressed.subtitleContentMode = parsed.scm;
        if (parsed.sob !== undefined) decompressed.subtitleOverlayBackground = parsed.sob;
        if (parsed.soo !== undefined) decompressed.subtitleOverlayOpacity = parsed.soo;
        if (parsed.shs !== undefined) decompressed.showHarmonySubtitle = parsed.shs;
        if (parsed.hsb !== undefined) decompressed.harmonySubtitleBackground = parsed.hsb;
        if (parsed.lfs) decompressed.lyricsFontStyle = parsed.lfs;
        if (parsed.lfn !== undefined) decompressed.lyricsFontScale = parsed.lfn;
        if (parsed.lfw !== undefined) decompressed.lyricsFontWeight = parsed.lfw;
        if (parsed.lff) decompressed.lyricsFontFallbackFamilies = parsed.lff;
        if (parsed.lcf) decompressed.lyricsCustomFontFamily = parsed.lcf;
        if (parsed.sfi !== undefined) decompressed.subtitleFontInheritsLyrics = parsed.sfi;
        if (parsed.sfsz !== undefined) decompressed.subtitleFontScale = parsed.sfsz;
        if (parsed.sfs) decompressed.subtitleFontStyle = parsed.sfs;
        if (parsed.sfw !== undefined) decompressed.subtitleFontWeight = parsed.sfw;
        if (parsed.sff) decompressed.subtitleFontFamily = parsed.sff;
        if (parsed.sfff) decompressed.subtitleFontFallbackFamilies = parsed.sfff;

        if (parsed.ct) decompressed.classicTuning = decompressClassic(parsed.ct);
        if (parsed.vt) decompressed.visualizerTunings = parsed.vt;
        if (parsed.cat) decompressed.cadenzaTuning = decompressCadenza(parsed.cat);
        if (parsed.pt) decompressed.partitaTuning = decompressPartita(parsed.pt);
        if (parsed.ft) decompressed.fumeTuning = decompressFume(parsed.ft);
        if (parsed.clt) decompressed.claddaghTuning = decompressCladdagh(parsed.clt);
        if (parsed.cpt) decompressed.cappellaTuning = decompressCappella(parsed.cpt);
        if (parsed.tt) decompressed.tiltTuning = decompressTilt(parsed.tt);
        if (parsed.dot) decompressed.dioramaTuning = decompressDiorama(parsed.dot);
        if (parsed.mbt) decompressed.monetBackgroundTuning = decompressMonetBackground(parsed.mbt);
        if (parsed.nbt) decompressed.nomandBackgroundTuning = decompressNomandBackground(parsed.nbt);
        if (parsed.lbt) decompressed.latentBackgroundTuning = decompressLatentBackground(parsed.lbt);
        if (parsed.mt) decompressed.monetTuning = decompressMonet(parsed.mt);
        if (parsed.pdt) decompressed.pendoloTuning = decompressPendolo(parsed.pdt);
        if (parsed.snt) decompressed.sonnetTuning = decompressSonnet(parsed.snt);
        if (parsed.tmp) decompressed.temperaTuning = decompressTempera(parsed.tmp);
        if (parsed.ubl) decompressed.urlBackgroundList = parsed.ubl;
        if (parsed.ubid) decompressed.urlBackgroundSelectedId = parsed.ubid;
        if (parsed.stas !== undefined) decompressed.songThemeAutoSwitchEnabled = parsed.stas;
        if (parsed.stag !== undefined) decompressed.songThemeAutoGenerateEnabled = parsed.stag;
        if (parsed.tgs !== undefined) decompressed.themeGenerationSource = parsed.tgs;
        if (parsed.fst !== undefined) decompressed.followSystemTheme = parsed.fst;
        if (parsed.stp !== undefined) decompressed.stageTrackPillMode = parsed.stp;
        if (parsed.stpt !== undefined) decompressed.stageTrackPillTimeoutSec = parsed.stpt;
        if (parsed.stph !== undefined) decompressed.stageTrackPillOnHome = parsed.stph;

        return decompressed;
    } else {
        const validKeys = [
            'theme', 'visualizerMode', 'randomVisualizerModePerSong', 'visualizerBackgroundMode', 'backgroundOpacity',
            'useCoverColorBg', 'disableVisualizerGeometricBackground', 'disableVisualizerVignette', 'staticMode',
            'visualizerOpacity', 'hidePlayerTranslationSubtitle', 'showSubtitleTranslation', 'subtitleContentMode',
            'subtitleOverlayBackground', 'subtitleOverlayOpacity',
            'showHarmonySubtitle', 'harmonySubtitleBackground',
            'lyricsFontStyle', 'lyricsFontScale', 'lyricsFontWeight', 'lyricsFontFallbackFamilies',
            'subtitleFontInheritsLyrics', 'subtitleFontScale', 'subtitleFontStyle', 'subtitleFontWeight', 'subtitleFontFamily',
            'subtitleFontFallbackFamilies', 'visualizerTunings', 'classicTuning',
            'cadenzaTuning', 'partitaTuning', 'fumeTuning', 'claddaghTuning', 'cappellaTuning',
            'tiltTuning', 'dioramaTuning', 'monetBackgroundTuning', 'nomandBackgroundTuning', 'latentBackgroundTuning', 'monetTuning',
            'pendoloTuning', 'sonnetTuning', 'temperaTuning',
            'urlBackgroundList', 'urlBackgroundSelectedId',
            'songThemeAutoSwitchEnabled', 'songThemeAutoGenerateEnabled', 'themeGenerationSource', 'followSystemTheme',
            'stageTrackPillMode', 'stageTrackPillTimeoutSec', 'stageTrackPillOnHome',
        ];
        const hasValidKey = validKeys.some(k => parsed[k] !== undefined);
        if (!hasValidKey) {
            throw new Error('Invalid visual settings configuration');
        }
        return parsed;
    }
};

export const readSavedCustomTheme = (): DualTheme | undefined => {
    if (typeof window === 'undefined') return undefined;
    const saved = localStorage.getItem('custom_dual_theme');
    if (!saved) return undefined;
    try {
        return JSON.parse(saved) as DualTheme;
    } catch {
        return undefined;
    }
};
