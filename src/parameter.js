'use strict';

var YieldComponent = function (oid, yp, ydm) {

  this.organId = oid;
  this.yieldPercentage = yp;
  this.yieldDryMatter = ydm;
  
};


var IrrigationParameters = function (n, s) {
  
  this.nitrateConcentration = n || 0;
  this.sulfateConcentration = s || 0;

};


var AutomaticIrrigationParameters = function (a, t, n, s) {
  
  /* TODO: x || y evaluates to y if x = 0. This is not a problem if default (y) is 0 */
  this.amount = a || 17;
  this.threshold = t || 0.35;
  this.nitrateConcentration = n || 0;
  this.sulfateConcentration = s || 0;

};


var AOM_Properties = {

  /* C content in slowly decomposing added organic matter pool [kgC m-3] */
  vo_AOM_Slow: 0.0,  
  /* C content in rapidly decomposing added organic matter pool [kgC m-3] */
  vo_AOM_Fast: 0.0, 
  /* Rate for slow AOM transformation that will be calculated. */
  vo_AOM_SlowDecRate: 0.0, 
  /* Rate for fast AOM transformation that will be calculated. */
  vo_AOM_FastDecRate: 0.0, 
  /* Is dependent on environment */
  vo_AOM_SlowDecCoeff: 0.0, 
  /* Is dependent on environment */
  vo_AOM_FastDecCoeff: 0.0, 
  /* Decomposition rate coefficient for slow AOM pool at standard conditions */
  vo_AOM_SlowDecCoeffStandard: 1.0, 
  /* Decomposition rate coefficient for fast AOM pool at standard conditions */
  vo_AOM_FastDecCoeffStandard: 1.0, 
  /* Partial transformation from AOM to SMB (soil microbiological biomass) for slow AOMs. */
  vo_PartAOM_Slow_to_SMB_Slow: 0.0, 
  /* Partial transformation from AOM to SMB (soil microbiological biomass) for fast AOMs. */
  vo_PartAOM_Slow_to_SMB_Fast: 0.0, 
  /* Used for calculation N-value if only C-value is known. Usually a constant value. */
  vo_CN_Ratio_AOM_Slow: 1.0, 
  /* C-N-Ratio is dependent on the nutritional condition of the plant. */
  vo_CN_Ratio_AOM_Fast: 1.0, 
  /* Fertilization parameter */  
  vo_DaysAfterApplication: 0,  /* Fertilization parameter */
  vo_AOM_DryMatterContent: 0.0, 
  /* Fertilization parameter */
  vo_AOM_NH4Content: 0.0, 
  /* Difference of AOM slow between to timesteps */
  vo_AOM_SlowDelta: 0.0, 
  /* Difference of AOM slow between to timesteps */
  vo_AOM_FastDelta: 0.0, 
  /* True if organic fertilizer is added with a subsequent incorporation. */
  incorporation: false // TODO: rename -> doIncorporate

};


var GeneralParameters = function () {

  // TODO: seems ps_LayerThickness is needless -> make GeneralParameters an object literal

  // layer thickness, profil depth and number of layers are constants
  this._ps_LayerThickness = 0.1;
  this.ps_ProfileDepth = 2.0;
  this.ps_LayerThickness = new Float64Array(20);
  this.ps_MaxMineralisationDepth = 0.4;
  this.pc_NitrogenResponseOn = true;
  this.pc_WaterDeficitResponseOn = true;
  this.pc_EmergenceFloodingControlOn = false;
  this.pc_EmergenceMoistureControlOn = false;

  for (var i = 0; i < this.ps_LayerThickness.length; i++)
    this.ps_LayerThickness[i] = this._ps_LayerThickness;

  this.ps_NumberOfLayers = function () { 
    return 20 /*this.ps_LayerThickness.length*/;
  };

};


var SiteParameters = {
    
  vs_Latitude: 60.0, 
  vs_Slope: 0.01, 
  vs_HeightNN: 50.0, 
  vs_GroundwaterDepth: 70.0, 
  vs_Soil_CN_Ratio: 10.0, 
  vs_DrainageCoeff: 1.0, 
  vq_NDeposition: 30.0, 
  vs_MaxEffectiveRootingDepth: 2.0

};


var SoilParameters = {

  vs_SoilSandContent: 0.4,
  vs_SoilClayContent: 0.05,
  vs_SoilpH: 6.9,
  vs_SoilStoneContent: -1,
  vs_Lambda: -1,
  vs_FieldCapacity: -1,
  vs_Saturation: -1,
  vs_PermanentWiltingPoint: -1,
  vs_SoilTexture: '',
  vs_SoilAmmonium: -1,
  vs_SoilNitrate: -1,
  _vs_SoilRawDensity: -1,
  _vs_SoilBulkDensity: -1,
  _vs_SoilOrganicCarbon: -1,
  _vs_SoilOrganicMatter: -1,
  isValid = function () {

    var is_valid = true;

    if (this.vs_FieldCapacity <= 0) {
        logger(MSG.WARN, "SoilParameters::Error: No field capacity defined in database for " + this.vs_SoilTexture + " , RawDensity: "+ this._vs_SoilRawDensity);
        is_valid = false;
    }

    if (this.vs_Saturation <= 0) {
        logger(MSG.WARN, "SoilParameters::Error: No saturation defined in database for " + this.vs_SoilTexture + " , RawDensity: " + this._vs_SoilRawDensity);
        is_valid = false;
    }
    
    if (this.vs_PermanentWiltingPoint <= 0) {
        logger(MSG.WARN, "SoilParameters::Error: No saturation defined in database for " + this.vs_SoilTexture + " , RawDensity: " + this._vs_SoilRawDensity);
        is_valid = false;
    }

    if (this.vs_SoilSandContent < 0) {
        logger(MSG.WARN, "SoilParameters::Error: Invalid soil sand content: "+ this.vs_SoilSandContent);
        is_valid = false;
    }

    if (this.vs_SoilClayContent < 0) {
        logger(MSG.WARN, "SoilParameters::Error: Invalid soil clay content: "+ this.vs_SoilClayContent);
        is_valid = false;
    }

    if (this.vs_SoilpH < 0) {
        logger(MSG.WARN, "SoilParameters::Error: Invalid soil ph value: "+ this.vs_SoilpH);
        is_valid = false;
    }

    if (this.vs_SoilStoneContent < 0) {
        logger(MSG.WARN, "SoilParameters::Error: Invalid soil stone content: "+ this.vs_SoilStoneContent);
        is_valid = false;
    }

    if (this.vs_Saturation < 0) {
        logger(MSG.WARN, "SoilParameters::Error: Invalid value for saturation: "+ this.vs_Saturation);
        is_valid = false;
    }

    if (this.vs_PermanentWiltingPoint < 0) {
        logger(MSG.WARN, "SoilParameters::Error: Invalid value for permanent wilting point: "+ this.vs_PermanentWiltingPoint);
        is_valid = false;
    }

    // if (this._vs_SoilRawDensity<0) {
    //     logger(MSG.WARN, "SoilParameters::Error: Invalid soil raw density: "+ this._vs_SoilRawDensity);
    //     is_valid = false;
    // }

    return is_valid;
  },
  vs_SoilRawDensity = function () {
    // conversion from g cm-3 in kg m-3
    return this._vs_SoilRawDensity * 1000;
  },
  set_vs_SoilRawDensity = function (srd) {
    this._vs_SoilRawDensity = srd;
  },
  vs_SoilOrganicCarbon = function () {
    if (this._vs_SoilOrganicMatter < 0)
      return this._vs_SoilOrganicCarbon;

    return this._vs_SoilOrganicMatter * organicConstants.po_SOM_to_C;
  },
  set_vs_SoilOrganicCarbon = function (soc) {
    this._vs_SoilOrganicCarbon = soc;
  },
  vs_SoilOrganicMatter = function () {
    if (this._vs_SoilOrganicCarbon < 0)
      return this._vs_SoilOrganicMatter;
    return this._vs_SoilOrganicCarbon / organicConstants.po_SOM_to_C;
  },
  set_vs_SoilOrganicMatter = function (som) {
    this._vs_SoilOrganicMatter = som;
  },
  vs_SoilSiltContent = function () {
    if ((this.vs_SoilSandContent - 0.001) < 0 && (this.vs_SoilClayContent - 0.001) < 0)
      return 0;

    return 1 - this.vs_SoilSandContent - this.s_SoilClayContent;
  },
  /*
    bulk density [kg m-3]
    TODO: check unit
  */
  vs_SoilBulkDensity = function () {
    if (this._vs_SoilRawDensity < 0)
      return this._vs_SoilBulkDensity;

    return (this._vs_SoilRawDensity + (0.009 * 100 * this.vs_SoilClayContent)) * 1000;
  }
  /*
    soilBulkDensity [g cm-3]
    TODO: check unit
  */
  set_vs_SoilBulkDensity = function (sbd) {
    this._vs_SoilBulkDensity = sbd;
  },
  texture2lambda = function (sand, clay) {
    return Tools.texture2lambda(sand, clay);
  }

};


var OrganicMatterParameters = {

  name: 'unnamed',
  vo_AOM_DryMatterContent: 0.0,
  vo_AOM_NH4Content: 0.0,
  vo_AOM_NO3Content: 0.0,
  vo_AOM_CarbamidContent: 0.0,
  vo_AOM_SlowDecCoeffStandard: 0.0,
  vo_AOM_FastDecCoeffStandard: 0.0,
  vo_PartAOM_to_AOM_Slow: 0.0,
  vo_PartAOM_to_AOM_Fast: 0.0,
  vo_CN_Ratio_AOM_Slow: 0.0,
  vo_CN_Ratio_AOM_Fast: 0.0,
  vo_PartAOM_Slow_to_SMB_Slow: 0.0,
  vo_PartAOM_Slow_to_SMB_Fast: 0.0,
  vo_NConcentration: 0.0

};


var CentralParameterProvider = {
  userCropParameters: {
    pc_Tortuosity: 0.002,
    pc_CanopyReflectionCoefficient: 0.08,
    pc_ReferenceMaxAssimilationRate: 30,
    pc_ReferenceLeafAreaIndex: 1.44,
    pc_MaintenanceRespirationParameter2: 44,
    pc_MaintenanceRespirationParameter1: 0.08,
    pc_MinimumNConcentrationRoot: 0.005,
    pc_MinimumAvailableN: 0.000075,
    pc_ReferenceAlbedo: 0.23,
    pc_StomataConductanceAlpha: 40,
    pc_SaturationBeta: 2.5,
    pc_GrowthRespirationRedux: 0.7,
    pc_MaxCropNDemand: 6,
    pc_GrowthRespirationParameter2: 38,
    pc_GrowthRespirationParameter1: 0.1
  },
  userEnvironmentParameters: {
    p_MaxGroundwaterDepth: 18,
    p_MinGroundwaterDepth: 20,
    p_UseAutomaticIrrigation: false,
    p_UseNMinMineralFertilisingMethod: false,
    p_LayerThickness: 0.1,
    p_NumberOfLayers: 20,
    p_StartPVIndex: 0,
    p_Albedo: 0.23,
    p_AthmosphericCO2: 0,
    p_WindSpeedHeight: 2,
    p_UseSecondaryYields: true,
    p_JulianDayAutomaticFertilising: 74,
    p_timeStep: 1,
    p_LeachingDepth: 1.6,
    p_MinGroundwaterDepthMonth: 3
  },
  userSoilMoistureParameters: {
    pm_CriticalMoistureDepth: 0.3,
    pm_SaturatedHydraulicConductivity: 8640,
    pm_SurfaceRoughness: 0.02,
    pm_HydraulicConductivityRedux: 0.1,
    pm_SnowAccumulationTresholdTemperature: 1.8,
    pm_KcFactor: 0.75,
    pm_TemperatureLimitForLiquidWater: -3,
    pm_CorrectionSnow: 1.14,
    pm_CorrectionRain: 1,
    pm_SnowMaxAdditionalDensity: 0.25,
    pm_NewSnowDensityMin: 0.1,
    pm_SnowRetentionCapacityMin: 0.05,
    pm_RefreezeParameter2: 0.36,
    pm_RefreezeParameter1: 1.5,
    pm_RefreezeTemperature: -1.7,
    pm_SnowMeltTemperature: 0.31,
    pm_SnowPacking: 0.01,
    pm_SnowRetentionCapacityMax: 0.17,
    pm_EvaporationZeta: 40,
    pm_XSACriticalSoilMoisture: 0.1,
    pm_MaximumEvaporationImpactDepth: 5,
    pm_MaxPercolationRate: 10,
    pm_GroundwaterDischarge: 3
  },
  userSoilTemperatureParameters: {
    pt_SoilMoisture: 0.25,
    pt_NTau: 0.65,
    pt_InitialSurfaceTemperature: 10,
    pt_BaseTemperature: 9.5,
    pt_QuartzRawDensity: 2650,
    pt_DensityAir: 1.25,
    pt_DensityWater: 1000,
    pt_SpecificHeatCapacityAir: 1005,
    pt_SpecificHeatCapacityQuartz: 750,
    pt_SpecificHeatCapacityWater: 4192,
    pt_SoilAlbedo: 0.7,
    pt_DensityHumus: 1300,
    pt_SpecificHeatCapacityHumus: 1920
  },
  userSoilTransportParameters: {
    pq_DispersionLength: 0.049,
    pq_AD: 0.002,
    pq_DiffusionCoefficientStandard: 0.000214
  },
  userSoilOrganicParameters: {
    po_SOM_SlowDecCoeffStandard: 0.000043,
    po_SOM_FastDecCoeffStandard: 0.00014,
    po_SMB_SlowMaintRateStandard: 0.001,
    po_SMB_FastMaintRateStandard: 0.01,
    po_SMB_SlowDeathRateStandard: 0.001,
    po_SMB_FastDeathRateStandard: 0.01,
    po_SMB_UtilizationEfficiency: 0,
    po_SOM_SlowUtilizationEfficiency: 0.4,
    po_SOM_FastUtilizationEfficiency: 0.5,
    po_AOM_SlowUtilizationEfficiency: 0.4,
    po_AOM_FastUtilizationEfficiency: 0.1,
    po_AOM_FastMaxC_to_N: 1000,
    po_PartSOM_Fast_to_SOM_Slow: 0.3,
    po_PartSMB_Slow_to_SOM_Fast: 0.6,
    po_PartSMB_Fast_to_SOM_Fast: 0.6,
    po_PartSOM_to_SMB_Slow: 0.015,
    po_PartSOM_to_SMB_Fast: 0.0002,
    po_CN_Ratio_SMB: 6.7,
    po_LimitClayEffect: 0.25,
    po_AmmoniaOxidationRateCoeffStandard: 0.1,
    po_NitriteOxidationRateCoeffStandard: 0.2,
    po_TransportRateCoeff: 0.1,
    po_SpecAnaerobDenitrification: 0.1,
    po_ImmobilisationRateCoeffNO3: 0.5,
    po_ImmobilisationRateCoeffNH4: 0.5,
    po_Denit1: 0.2,
    po_Denit2: 0.8,
    po_Denit3: 0.9,
    po_HydrolysisKM: 0.00334,
    po_ActivationEnergy: 41000,
    po_HydrolysisP1: 4.259e-12,
    po_HydrolysisP2: 1.408e-12,
    po_AtmosphericResistance: 0.0025,
    po_N2OProductionRate: 0.015,
    po_Inhibitor_NH3: 1
  },
  capillaryRiseRates: {
    map: {
      Su3: {
        1: 0.0055,
        2: 0.0055,
        3: 0.0055,
        4: 0.0055,
        5: 0.0055,
        6: 0.005,
        7: 0.0035,
        8: 0.0028,
        9: 0.0022,
        10: 0.0017,
        11: 0.0014,
        12: 0.0012,
        13: 0.0009,
        14: 0.0008,
        15: 0.0007,
        16: 0.0007,
        17: 0.0005,
        18: 0.0005,
        19: 0.0005,
        20: 0.0003,
        21: 0.0003,
        22: 0.0003,
        23: 0.0003,
        24: 0.0003,
        25: 0.0001,
        26: 0,
        27: 0
      },
      Sl3: {
        1: 0.0055,
        2: 0.0055,
        3: 0.0055,
        4: 0.005,
        5: 0.0025,
        6: 0.0016,
        7: 0.0011,
        8: 0.0007,
        9: 0.0005,
        10: 0.0003,
        11: 0.0002,
        12: 0.0001,
        13: 0,
        14: 0,
        15: 0,
        16: 0,
        17: 0,
        18: 0,
        19: 0,
        20: 0,
        21: 0,
        22: 0,
        23: 0,
        24: 0,
        25: 0,
        26: 0,
        27: 0
      },
      Sl2: {
        1: 0.0055,
        2: 0.0055,
        3: 0.005,
        4: 0.0026,
        5: 0.0013,
        6: 0.0008,
        7: 0.0005,
        8: 0.0003,
        9: 0.0002,
        10: 0.0001,
        11: 0,
        12: 0,
        13: 0,
        14: 0,
        15: 0,
        16: 0,
        17: 0,
        18: 0,
        19: 0,
        20: 0,
        21: 0,
        22: 0,
        23: 0,
        24: 0,
        25: 0,
        26: 0,
        27: 0
      },
      Su4: {
        1: 0.0055,
        2: 0.0055,
        3: 0.0055,
        4: 0.0055,
        5: 0.0055,
        6: 0.0055,
        7: 0.005,
        8: 0.0039,
        9: 0.0029,
        10: 0.0023,
        11: 0.0018,
        12: 0.0015,
        13: 0.0012,
        14: 0.0009,
        15: 0.0008,
        16: 0.0008,
        17: 0.0005,
        18: 0.0005,
        19: 0.0005,
        20: 0.0003,
        21: 0.0003,
        22: 0.0003,
        23: 0.0003,
        24: 0.0003,
        25: 0.0001,
        26: 0,
        27: 0
      },
      Su2: {
        1: 0.0055,
        2: 0.0055,
        3: 0.0055,
        4: 0.0055,
        5: 0.005,
        6: 0.003,
        7: 0.0022,
        8: 0.0017,
        9: 0.0012,
        10: 0.001,
        11: 0.0008,
        12: 0.0006,
        13: 0.0005,
        14: 0.0004,
        15: 0.0003,
        16: 0.0003,
        17: 0.0002,
        18: 0.0002,
        19: 0.0002,
        20: 0.0001,
        21: 0,
        22: 0,
        23: 0,
        24: 0,
        25: 0,
        26: 0,
        27: 0
      },
      Sl4: {
        1: 0.0055,
        2: 0.0055,
        3: 0.0055,
        4: 0.005,
        5: 0.0036,
        6: 0.0024,
        7: 0.0016,
        8: 0.0012,
        9: 0.0008,
        10: 0.0006,
        11: 0.0004,
        12: 0.0003,
        13: 0.0002,
        14: 0.0001,
        15: 0,
        16: 0,
        17: 0,
        18: 0,
        19: 0,
        20: 0,
        21: 0,
        22: 0,
        23: 0,
        24: 0,
        25: 0,
        26: 0,
        27: 0
      },
      Slu: {
        1: 0.0055,
        2: 0.0055,
        3: 0.0055,
        4: 0.0055,
        5: 0.005,
        6: 0.0036,
        7: 0.0026,
        8: 0.0019,
        9: 0.0015,
        10: 0.0011,
        11: 0.0009,
        12: 0.0007,
        13: 0.0005,
        14: 0.0004,
        15: 0.0003,
        16: 0.0003,
        17: 0.0002,
        18: 0.0002,
        19: 0.0002,
        20: 0.0001,
        21: 0,
        22: 0,
        23: 0,
        24: 0,
        25: 0,
        26: 0,
        27: 0
      },
      St2: {
        1: 0.0055,
        2: 0.0055,
        3: 0.005,
        4: 0.0029,
        5: 0.0018,
        6: 0.0011,
        7: 0.0007,
        8: 0.0005,
        9: 0.0004,
        10: 0.0003,
        11: 0.0002,
        12: 0.0001,
        13: 0,
        14: 0,
        15: 0,
        16: 0,
        17: 0,
        18: 0,
        19: 0,
        20: 0,
        21: 0,
        22: 0,
        23: 0,
        24: 0,
        25: 0,
        26: 0,
        27: 0
      },
      St3: {
        1: 0.0055,
        2: 0.0055,
        3: 0.005,
        4: 0.0029,
        5: 0.0018,
        6: 0.0011,
        7: 0.0007,
        8: 0.0005,
        9: 0.0004,
        10: 0.0003,
        11: 0.0002,
        12: 0.0001,
        13: 0,
        14: 0,
        15: 0,
        16: 0,
        17: 0,
        18: 0,
        19: 0,
        20: 0,
        21: 0,
        22: 0,
        23: 0,
        24: 0,
        25: 0,
        26: 0,
        27: 0
      },
      fS: {
        1: 0.0055,
        2: 0.0055,
        3: 0.0055,
        4: 0.0055,
        5: 0.005,
        6: 0.0033,
        7: 0.0022,
        8: 0.0014,
        9: 0.0009,
        10: 0.0005,
        11: 0.0003,
        12: 0.0002,
        13: 0.0001,
        14: 0,
        15: 0,
        16: 0,
        17: 0,
        18: 0,
        19: 0,
        20: 0,
        21: 0,
        22: 0,
        23: 0,
        24: 0,
        25: 0,
        26: 0,
        27: 0
      },
      gS: {
        1: 0.0055,
        2: 0.005,
        3: 0.0014,
        4: 0.0005,
        5: 0.0002,
        6: 0.0001,
        7: 0,
        8: 0,
        9: 0,
        10: 0,
        11: 0,
        12: 0,
        13: 0,
        14: 0,
        15: 0,
        16: 0,
        17: 0,
        18: 0,
        19: 0,
        20: 0,
        21: 0,
        22: 0,
        23: 0,
        24: 0,
        25: 0,
        26: 0,
        27: 0
      },
      mS: {
        1: 0.0055,
        2: 0.0055,
        3: 0.005,
        4: 0.0016,
        5: 0.0009,
        6: 0.0005,
        7: 0.0003,
        8: 0.0002,
        9: 0.0001,
        10: 0,
        11: 0,
        12: 0,
        13: 0,
        14: 0,
        15: 0,
        16: 0,
        17: 0,
        18: 0,
        19: 0,
        20: 0,
        21: 0,
        22: 0,
        23: 0,
        24: 0,
        25: 0,
        26: 0,
        27: 0
      },
      Ss: {
        1: 0.0055,
        2: 0.0055,
        3: 0.005,
        4: 0.0016,
        5: 0.0009,
        6: 0.0005,
        7: 0.0003,
        8: 0.0002,
        9: 0.0001,
        10: 0,
        11: 0,
        12: 0,
        13: 0,
        14: 0,
        15: 0,
        16: 0,
        17: 0,
        18: 0,
        19: 0,
        20: 0,
        21: 0,
        22: 0,
        23: 0,
        24: 0,
        25: 0,
        26: 0,
        27: 0
      },
      Us: {
        1: 0.0055,
        2: 0.0055,
        3: 0.0055,
        4: 0.0055,
        5: 0.0055,
        6: 0.0055,
        7: 0.005,
        8: 0.0041,
        9: 0.0033,
        10: 0.0027,
        11: 0.0022,
        12: 0.0018,
        13: 0.0015,
        14: 0.0012,
        15: 0.001,
        16: 0.001,
        17: 0.0007,
        18: 0.0007,
        19: 0.0007,
        20: 0.0004,
        21: 0.0004,
        22: 0.0004,
        23: 0.0004,
        24: 0.0004,
        25: 0.0001,
        26: 0.0001,
        27: 0
      },
      Uu: {
        1: 0.0055,
        2: 0.0055,
        3: 0.0055,
        4: 0.0055,
        5: 0.0055,
        6: 0.0055,
        7: 0.0055,
        8: 0.0055,
        9: 0.0055,
        10: 0.005,
        11: 0.004,
        12: 0.0033,
        13: 0.0028,
        14: 0.0024,
        15: 0.002,
        16: 0.002,
        17: 0.0015,
        18: 0.0015,
        19: 0.0015,
        20: 0.001,
        21: 0.001,
        22: 0.001,
        23: 0.001,
        24: 0.001,
        25: 0.0005,
        26: 0.0003,
        27: 0.0001
      },
      Uls: {
        1: 0.0055,
        2: 0.0055,
        3: 0.0055,
        4: 0.0055,
        5: 0.0055,
        6: 0.0055,
        7: 0.0055,
        8: 0.0055,
        9: 0.005,
        10: 0.0044,
        11: 0.0036,
        12: 0.003,
        13: 0.0026,
        14: 0.0022,
        15: 0.0019,
        16: 0.0019,
        17: 0.0014,
        18: 0.0014,
        19: 0.0014,
        20: 0.0009,
        21: 0.0009,
        22: 0.0009,
        23: 0.0009,
        24: 0.0009,
        25: 0.0005,
        26: 0.0003,
        27: 0.0001
      },
      Ut2: {
        1: 0.0055,
        2: 0.0055,
        3: 0.0055,
        4: 0.0055,
        5: 0.0055,
        6: 0.0055,
        7: 0.0055,
        8: 0.005,
        9: 0.0035,
        10: 0.0028,
        11: 0.0023,
        12: 0.0019,
        13: 0.0015,
        14: 0.0013,
        15: 0.0011,
        16: 0.0011,
        17: 0.0007,
        18: 0.0007,
        19: 0.0007,
        20: 0.0004,
        21: 0.0004,
        22: 0.0004,
        23: 0.0004,
        24: 0.0004,
        25: 0.0001,
        26: 0.0001,
        27: 0
      },
      Ut3: {
        1: 0.0055,
        2: 0.0055,
        3: 0.0055,
        4: 0.0055,
        5: 0.0055,
        6: 0.0055,
        7: 0.0055,
        8: 0.005,
        9: 0.0035,
        10: 0.0028,
        11: 0.0022,
        12: 0.0018,
        13: 0.0015,
        14: 0.0013,
        15: 0.0011,
        16: 0.0011,
        17: 0.0007,
        18: 0.0007,
        19: 0.0007,
        20: 0.0004,
        21: 0.0004,
        22: 0.0004,
        23: 0.0004,
        24: 0.0004,
        25: 0.0001,
        26: 0.0001,
        27: 0
      },
      Ut4: {
        1: 0.0055,
        2: 0.0055,
        3: 0.0055,
        4: 0.0055,
        5: 0.0055,
        6: 0.0055,
        7: 0.005,
        8: 0.0036,
        9: 0.0028,
        10: 0.0022,
        11: 0.0018,
        12: 0.0015,
        13: 0.0012,
        14: 0.001,
        15: 0.0008,
        16: 0.0008,
        17: 0.0005,
        18: 0.0005,
        19: 0.0005,
        20: 0.0003,
        21: 0.0003,
        22: 0.0003,
        23: 0.0003,
        24: 0.0003,
        25: 0.0001,
        26: 0.0001,
        27: 0
      },
      Ls2: {
        1: 0.0055,
        2: 0.0055,
        3: 0.0055,
        4: 0.0055,
        5: 0.0055,
        6: 0.0055,
        7: 0.004,
        8: 0.003,
        9: 0.0022,
        10: 0.0017,
        11: 0.0013,
        12: 0.0009,
        13: 0.0007,
        14: 0.0005,
        15: 0.0004,
        16: 0.0004,
        17: 0.0002,
        18: 0.0002,
        19: 0.0002,
        20: 0.0001,
        21: 0,
        22: 0,
        23: 0,
        24: 0,
        25: 0,
        26: 0,
        27: 0
      },
      Ls3: {
        1: 0.0055,
        2: 0.0055,
        3: 0.0055,
        4: 0.0055,
        5: 0.0055,
        6: 0.005,
        7: 0.0033,
        8: 0.0025,
        9: 0.002,
        10: 0.0015,
        11: 0.0012,
        12: 0.001,
        13: 0.0008,
        14: 0.0007,
        15: 0.0005,
        16: 0.0005,
        17: 0.0003,
        18: 0.0003,
        19: 0.0003,
        20: 0.0002,
        21: 0.0002,
        22: 0.0002,
        23: 0.0002,
        24: 0.0002,
        25: 0.0001,
        26: 0,
        27: 0
      },
      Ls4: {
        1: 0.0055,
        2: 0.0055,
        3: 0.0055,
        4: 0.0055,
        5: 0.0055,
        6: 0.0036,
        7: 0.0026,
        8: 0.002,
        9: 0.0015,
        10: 0.0012,
        11: 0.0009,
        12: 0.0007,
        13: 0.0006,
        14: 0.0005,
        15: 0.0004,
        16: 0.0004,
        17: 0.0003,
        18: 0.0003,
        19: 0.0003,
        20: 0.0001,
        21: 0,
        22: 0,
        23: 0,
        24: 0,
        25: 0,
        26: 0,
        27: 0
      },
      Lt2: {
        1: 0.0055,
        2: 0.0055,
        3: 0.0055,
        4: 0.0055,
        5: 0.005,
        6: 0.0038,
        7: 0.0028,
        8: 0.0022,
        9: 0.0017,
        10: 0.0013,
        11: 0.0011,
        12: 0.0009,
        13: 0.0007,
        14: 0.0005,
        15: 0.0004,
        16: 0.0004,
        17: 0.0003,
        18: 0.0003,
        19: 0.0003,
        20: 0.0001,
        21: 0,
        22: 0,
        23: 0,
        24: 0,
        25: 0,
        26: 0,
        27: 0
      },
      Lt3: {
        1: 0.0055,
        2: 0.0055,
        3: 0.0055,
        4: 0.0055,
        5: 0.005,
        6: 0.0034,
        7: 0.0026,
        8: 0.0019,
        9: 0.0015,
        10: 0.0012,
        11: 0.001,
        12: 0.0008,
        13: 0.0007,
        14: 0.0006,
        15: 0.0005,
        16: 0.0005,
        17: 0.0003,
        18: 0.0003,
        19: 0.0003,
        20: 0.0002,
        21: 0.0002,
        22: 0.0002,
        23: 0.0002,
        24: 0.0002,
        25: 0.0001,
        26: 0,
        27: 0
      },
      Lu: {
        1: 0.0055,
        2: 0.0055,
        3: 0.0055,
        4: 0.0055,
        5: 0.0055,
        6: 0.005,
        7: 0.004,
        8: 0.0031,
        9: 0.0024,
        10: 0.0019,
        11: 0.0015,
        12: 0.0012,
        13: 0.001,
        14: 0.0008,
        15: 0.0007,
        16: 0.0007,
        17: 0.0005,
        18: 0.0005,
        19: 0.0005,
        20: 0.0003,
        21: 0.0003,
        22: 0.0003,
        23: 0.0003,
        24: 0.0003,
        25: 0.0001,
        26: 0.0001,
        27: 0
      },
      Lts: {
        1: 0.0055,
        2: 0.0055,
        3: 0.0055,
        4: 0.0055,
        5: 0.0005,
        6: 0.0032,
        7: 0.0022,
        8: 0.0016,
        9: 0.0012,
        10: 0.0009,
        11: 0.0007,
        12: 0.0005,
        13: 0.0004,
        14: 0.0003,
        15: 0.0002,
        16: 0.0002,
        17: 0.0001,
        18: 0,
        19: 0,
        20: 0,
        21: 0,
        22: 0,
        23: 0,
        24: 0,
        25: 0,
        26: 0,
        27: 0
      },
      Tt: {
        1: 0.0055,
        2: 0.005,
        3: 0.002,
        4: 0.001,
        5: 0.0006,
        6: 0.0004,
        7: 0.0003,
        8: 0.0002,
        9: 0.0002,
        10: 0.0001,
        11: 0,
        12: 0,
        13: 0,
        14: 0,
        15: 0,
        16: 0,
        17: 0,
        18: 0,
        19: 0,
        20: 0,
        21: 0,
        22: 0,
        23: 0,
        24: 0,
        25: 0,
        26: 0,
        27: 0
      },
      Tl: {
        1: 0.0055,
        2: 0.005,
        3: 0.0026,
        4: 0.0013,
        5: 0.0008,
        6: 0.0005,
        7: 0.0004,
        8: 0.0003,
        9: 0.0002,
        10: 0.0001,
        11: 0,
        12: 0,
        13: 0,
        14: 0,
        15: 0,
        16: 0,
        17: 0,
        18: 0,
        19: 0,
        20: 0,
        21: 0,
        22: 0,
        23: 0,
        24: 0,
        25: 0,
        26: 0,
        27: 0
      },
      Tu2: {
        1: 0.0055,
        2: 0.005,
        3: 0.0026,
        4: 0.0013,
        5: 0.0008,
        6: 0.0005,
        7: 0.0004,
        8: 0.0003,
        9: 0.0002,
        10: 0.0001,
        11: 0,
        12: 0,
        13: 0,
        14: 0,
        15: 0,
        16: 0,
        17: 0,
        18: 0,
        19: 0,
        20: 0,
        21: 0,
        22: 0,
        23: 0,
        24: 0,
        25: 0,
        26: 0,
        27: 0
      },
      Tu3: {
        1: 0.0055,
        2: 0.0055,
        3: 0.005,
        4: 0.0024,
        5: 0.0014,
        6: 0.0009,
        7: 0.0007,
        8: 0.0005,
        9: 0.0004,
        10: 0.0003,
        11: 0.0003,
        12: 0.0002,
        13: 0.0002,
        14: 0.0001,
        15: 0,
        16: 0,
        17: 0,
        18: 0,
        19: 0,
        20: 0,
        21: 0,
        22: 0,
        23: 0,
        24: 0,
        25: 0,
        26: 0,
        27: 0
      },
      Tu4: {
        1: 0.0055,
        2: 0.0055,
        3: 0.0055,
        4: 0.005,
        5: 0.0024,
        6: 0.0016,
        7: 0.0012,
        8: 0.0008,
        9: 0.0006,
        10: 0.0005,
        11: 0.0004,
        12: 0.0003,
        13: 0.0003,
        14: 0.0002,
        15: 0.0002,
        16: 0.0002,
        17: 0.0001,
        18: 0,
        19: 0,
        20: 0,
        21: 0,
        22: 0,
        23: 0,
        24: 0,
        25: 0,
        26: 0,
        27: 0
      },
      Ts2: {
        1: 0.0055,
        2: 0.0055,
        3: 0.005,
        4: 0.002,
        5: 0.0012,
        6: 0.0008,
        7: 0.0005,
        8: 0.0004,
        9: 0.0003,
        10: 0.0002,
        11: 0.0002,
        12: 0.0001,
        13: 0,
        14: 0,
        15: 0,
        16: 0,
        17: 0,
        18: 0,
        19: 0,
        20: 0,
        21: 0,
        22: 0,
        23: 0,
        24: 0,
        25: 0,
        26: 0,
        27: 0
      },
      Ts3: {
        1: 0.0055,
        2: 0.0055,
        3: 0.005,
        4: 0.0029,
        5: 0.0018,
        6: 0.0011,
        7: 0.0007,
        8: 0.0005,
        9: 0.0004,
        10: 0.0003,
        11: 0.0002,
        12: 0.0001,
        13: 0,
        14: 0,
        15: 0,
        16: 0,
        17: 0,
        18: 0,
        19: 0,
        20: 0,
        21: 0,
        22: 0,
        23: 0,
        24: 0,
        25: 0,
        26: 0,
        27: 0
      },
      Ts4: {
        1: 0.0055,
        2: 0.0055,
        3: 0.005,
        4: 0.0029,
        5: 0.0018,
        6: 0.0011,
        7: 0.0007,
        8: 0.0005,
        9: 0.0004,
        10: 0.0003,
        11: 0.0002,
        12: 0.0001,
        13: 0,
        14: 0,
        15: 0,
        16: 0,
        17: 0,
        18: 0,
        19: 0,
        20: 0,
        21: 0,
        22: 0,
        23: 0,
        24: 0,
        25: 0,
        26: 0,
        27: 0
      },
      Hh: {
        1: 0.005,
        2: 0.005,
        3: 0.003,
        4: 0.002,
        5: 0.0013,
        6: 0.0008,
        7: 0.0004,
        8: 0.0003,
        9: 0.0002,
        10: 0.0002,
        11: 0.00005,
        12: 0.00005,
        13: 0,
        14: 0,
        15: 0,
        16: 0,
        17: 0,
        18: 0,
        19: 0,
        20: 0,
        21: 0,
        22: 0,
        23: 0,
        24: 0,
        25: 0,
        26: 0,
        27: 0
      },
      Hn: {
        1: 0.004,
        2: 0.004,
        3: 0.0022,
        4: 0.0011,
        5: 0.0006,
        6: 0.0003,
        7: 0.0002,
        8: 0.0001,
        9: 0.00005,
        10: 0,
        11: 0,
        12: 0,
        13: 0,
        14: 0,
        15: 0,
        16: 0,
        17: 0,
        18: 0,
        19: 0,
        20: 0,
        21: 0,
        22: 0,
        23: 0,
        24: 0,
        25: 0,
        26: 0,
        27: 0
      }
    },
    addRate: function (textureClass, distance, value) {
      if (this.map[textureClass] === undefined)
        this.map[textureClass] = {};
      this.map[textureClass][distance] = value;
    },
    getRate: function (textureClass, distance) {
      distance = int(distance);
      var map = getMap(textureClass);
      return (map[distance] === undefined) ? 0.0 : map[distance]);
    },
    getMap: function (textureClass) {
      if (this.map[textureClass] === undefined) {
        logger(MSG.WARN, "No capillary rise rates for texture '"+texture+"' available: using default (Sl4)");
        textureClass = 'Sl4';
      }      
      return this.map[textureClass];
    },
    size: function () { 
      var size = 0;
      for (var prop in this.map) {
        if (this.map.hasOwnProperty(prop))
          size++;
      } 
      return size;
    }
  },
  userInitValues: {
    p_initPercentageFC: 0.8,
    p_initSoilNitrate: 0.0001,
    p_initSoilAmmonium: 0.0001
  }
};
