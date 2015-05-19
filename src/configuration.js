/*

  TODO:
    - date, doy optional?
    - use date string instead of Date obj?
    - what if sunhours not available?

  weatherData = {                   object
      tmin          [°C]            array, daily minimum temperature
    , tmax          [°C]            array, daily maximum temperature
    , tavg          [°C]            array, daily average temperature
    , globrad       [MJ m-2]        array, global radiation
    , exrad         [MJ m-2]        array, extraterrestrial radiation
    , wind          [m s-1]         array, wind speed
    , precip        [mm]            array, rainfall
    , sunhours      [h]             array, sunshine hours, optional (use empty array if not available)
    , relhumid      [%]             array, relative humidity, optional (use empty array if not available)
    , daylength     [h]             array, daylength. required by grassland model
    , f_directrad   [h h-1]         array, fraction direct solar radiation. required by grassland model
    , date          [date string]   array, ISO date strings
    , doy           [#]             array, day of year
  }
  doDebug           [bool]          debug model and print MSG_DEBUG output
  isVerbose         [bool]          print MSG_INFO output
  callbacks         [array]         function or array of functions, access model variables at each time step 
                                    (write an output file, change model variables etc.)
*/

var Configuration = function (weatherData, doDebug, isVerbose, callbacks) {

  DEBUG = (doDebug === true) ? true : false;
  VERBOSE = (isVerbose === true) ? true : false;

  if (typeof callbacks === 'function')
    callbacks = [callbacks];    
  else if (!Array.isArray(callbacks) || callbacks.length === 0)
    callbacks = [defaultCallback]; /* set to default if arg not provided */

  // var pathToOutputDir = '.';
  var models = null
    , noModels = 0
    ;

  /*
    input is an object with sim, prod and site properties or an array of site and prod objects

    simulation = { ... }      simulation settings
    
    siteAndProd = {           obj
      site: { ... },          site, location
      production: { ... }     crop rotation
    }

      or

    siteAndProd = [{          array of objs
      site: { ... },          site 1, location
      production: { ... }     crop rotation 1
    }, {   
      site: { ... },          site n, location
      production: { ... }     crop rotation n
    }, ...]

  */

  var run = function (sim, siteAndProd) {

    var startDate = new Date(sim.time.startDate);
    var endDate = new Date(sim.time.endDate);

    /* weather */
    var weather = new Weather(startDate, endDate);
    if (!createWeather(weather, weatherData, Date.parse(sim.time.startDate), Date.parse(sim.time.endDate))) {
      logger(MSG_ERROR, 'Error fetching weather data.');
      return;
    }
    
    logger(MSG_INFO, 'Fetched weather data.');

    models = new ModelCollection(weather);

    if (!Array.isArray(siteAndProd))
      siteAndProd = [siteAndProd];

    noModels = siteAndProd.length;

    for (var sp = 0, sps = siteAndProd.length; sp < sps; sp++) {

      logger(MSG_INFO, 'Fetching parameter for site + ' + sp);
      
      var site = siteAndProd[sp].site;
      var prod = siteAndProd[sp].production;
      
      /* init parameters */
      var parameterProvider = new ParameterProvider();
      var siteParameters = new SiteParameters();
      var generalParameters = new GeneralParameters();

      /* sim */
      var startYear = startDate.getFullYear();
      var endYear = endDate.getFullYear();

      parameterProvider.userInitValues.p_initPercentageFC = getValue(sim.init, 'percentageFC', parameterProvider.userInitValues.p_initPercentageFC);
      parameterProvider.userInitValues.p_initSoilNitrate = getValue(sim.init, 'soilNitrate', parameterProvider.userInitValues.p_initSoilNitrate);
      parameterProvider.userInitValues.p_initSoilAmmonium = getValue(sim.init, 'soilAmmonium', parameterProvider.userInitValues.p_initSoilAmmonium);

      parameterProvider.userEnvironmentParameters.p_UseSecondaryYields = getValue(sim.switches, 'useSecondaryYieldOn', parameterProvider.userEnvironmentParameters.p_UseSecondaryYields);
      generalParameters.pc_NitrogenResponseOn = getValue(sim.switches, 'nitrogenResponseOn', generalParameters.pc_NitrogenResponseOn);
      generalParameters.pc_WaterDeficitResponseOn = getValue(sim.switches, 'waterDeficitResponseOn', generalParameters.pc_WaterDeficitResponseOn);
      generalParameters.pc_WaterDeficitResponseOn = getValue(sim.switches, 'lowTemperatureStressResponseOn', generalParameters.pc_LowTemperatureStressResponseOn);
      generalParameters.pc_WaterDeficitResponseOn = getValue(sim.switches, 'highTemperatureStressResponseOn', generalParameters.pc_HighTemperatureStressResponseOn);
      generalParameters.pc_EmergenceMoistureControlOn = getValue(sim.switches, 'emergenceMoistureControlOn', generalParameters.pc_EmergenceMoistureControlOn);
      generalParameters.pc_EmergenceFloodingControlOn = getValue(sim.switches, 'emergenceFloodingControlOn', generalParameters.pc_EmergenceFloodingControlOn);

      logger(MSG_INFO, 'Fetched simulation data.');
      
      /* site */
      siteParameters.vs_Latitude = site.latitude;
      siteParameters.vs_Slope = site.slope;
      siteParameters.vs_HeightNN = site.heightNN;
      siteParameters.vq_NDeposition = getValue(site, 'NDeposition', siteParameters.vq_NDeposition);

      parameterProvider.userEnvironmentParameters.p_AthmosphericCO2 = getValue(site, 'atmosphericCO2', parameterProvider.userEnvironmentParameters.p_AthmosphericCO2);
      parameterProvider.userEnvironmentParameters.p_MinGroundwaterDepth = getValue(site, 'groundwaterDepthMin', parameterProvider.userEnvironmentParameters.p_MinGroundwaterDepth);
      parameterProvider.userEnvironmentParameters.p_MaxGroundwaterDepth = getValue(site, 'groundwaterDepthMax', parameterProvider.userEnvironmentParameters.p_MaxGroundwaterDepth);
      parameterProvider.userEnvironmentParameters.p_MinGroundwaterDepthMonth = getValue(site, 'groundwaterDepthMinMonth', parameterProvider.userEnvironmentParameters.p_MinGroundwaterDepthMonth);
      parameterProvider.userEnvironmentParameters.p_WindSpeedHeight = getValue(site, 'windSpeedHeight', parameterProvider.userEnvironmentParameters.p_WindSpeedHeight);  
      parameterProvider.userEnvironmentParameters.p_LeachingDepth = getValue(site, 'leachingDepth', parameterProvider.userEnvironmentParameters.p_LeachingDepth);

      logger(MSG_INFO, 'Fetched site data.');

      /* soil */
      var lThicknessCm = 100.0 * parameterProvider.userEnvironmentParameters.p_LayerThickness;
      var maxDepthCm =  200.0;
      var maxNoOfLayers = toInt(maxDepthCm / lThicknessCm);

      var layers = [];
      if (!createLayers(layers, site.horizons, lThicknessCm, maxNoOfLayers)) {
        logger(MSG_ERROR, 'Error fetching soil data.');
        return;
      }
      
      logger(MSG_INFO, 'Fetched soil data.');

      /* crops */
      var cropRotation = [];
      if (!createProcesses(cropRotation, prod, startDate)) {
        logger(MSG_ERROR, 'Error fetching crop data.');
        return;
      }
      
      logger(MSG_INFO, 'Fetched crop data.');

      var env = new Environment(layers, parameterProvider);
      env.general = generalParameters;
      // env.pathToOutputDir = pathToOutputDir;
      // env.setMode(1); // JS! not implemented
      env.site = siteParameters;
      // env.da = da; // now in ModelCollection.weather
      env.cropRotation = cropRotation;
     
      // TODO: implement and test useAutomaticIrrigation & useNMinFertiliser
      // if (hermes_config->useAutomaticIrrigation()) {
      //   env.useAutomaticIrrigation = true;
      //   env.autoIrrigationParams = hermes_config->getAutomaticIrrigationParameters();
      // }

      // if (hermes_config->useNMinFertiliser()) {
      //   env.useNMinMineralFertilisingMethod = true;
      //   env.nMinUserParams = hermes_config->getNMinUserParameters();
      //   env.nMinFertiliserPartition = getMineralFertiliserParametersFromMonicaDB(hermes_config->getMineralFertiliserID());
      // }

      models.push(new Model(env));
    
    } // for each input
    
    logger(MSG_INFO, 'Start model run.');
    
    return models.run(callbacks);

  };

  /* read value from JSON input and return default value if parameter is not available */
  function getValue(obj, prop, def) {

    if (obj.hasOwnProperty(prop) && obj[prop] != null)
      return obj[prop];
    else
      return def;

  }

  function createLayers(layers, horizons, lThicknessCm, maxNoOfLayers) {

    var ok = true;
    var hs = horizons.length;
    var depth = 0;
    
    logger(MSG_INFO, 'Fetching ' + hs + ' horizons.');

    for (var h = 0; h < hs; ++h ) {
      
      var horizon = horizons[h];
      var hThicknessCm = horizon.thickness * 100;
      var lInHCount = toInt(round(hThicknessCm / lThicknessCm));

      /* fill all (maxNoOfLayers) layers if available horizons depth < lThicknessCm * maxNoOfLayers */
      if (h == (hs - 1) && (toInt(layers.length) + lInHCount) < maxNoOfLayers)
        lInHCount += maxNoOfLayers - layers.length - lInHCount;

      for (var l = 0; l < lInHCount; l++) {

        /* stop if we reach max. depth */
        if (depth === maxNoOfLayers * lThicknessCm) {
          logger(MSG_WARN, 'Maximum soil layer depth (' + (maxNoOfLayers * lThicknessCm) + ' cm) reached. Remaining layers in horizon ' + h + ' ignored.');
          break;
        }

        depth += lThicknessCm;

        var soilParameters = new SoilParameters();

        soilParameters.set_vs_SoilOrganicMatter(horizon.organicMatter);
        soilParameters.vs_SoilSandContent = horizon.sand;
        soilParameters.vs_SoilClayContent = horizon.clay;
        soilParameters.vs_SoilStoneContent = horizon.sceleton;
        soilParameters.vs_SoilpH = horizon.pH;
        soilParameters.vs_SoilTexture = tools.texture2KA5(horizon.sand, horizon.clay);
        soilParameters.vs_Lambda = tools.texture2lambda(soilParameters.vs_SoilSandContent, soilParameters.vs_SoilClayContent);

        /* optional parameters */
        soilParameters.vs_SoilpH = getValue(horizon, 'pH', 6.9);

        /* set wilting point, saturation & field capacity */
        if ( horizon.hasOwnProperty('poreVolume') && horizon.poreVolume != null
          && horizon.hasOwnProperty('fieldCapacity') && horizon.fieldCapacity != null
          && horizon.hasOwnProperty('permanentWiltingPoint') && horizon.permanentWiltingPoint != null
          && horizon.hasOwnProperty('bulkDensity') && horizon.bulkDensity != null) { /* if all soil properties are available */

          soilParameters.set_vs_SoilBulkDensity(horizon.bulkDensity);
          soilParameters.vs_FieldCapacity = horizon.fieldCapacity;
          soilParameters.vs_Saturation = horizon.poreVolume - horizon.fieldCapacity;
          soilParameters.vs_PermanentWiltingPoint = horizon.permanentWiltingPoint;

        } else { /* if any is missing */

          /* if density class according to KA5 is available (trockenrohdichte-klassifikation) TODO: add ld_class to JSON cfg */
          // soilParameters.set_vs_SoilRawDensity(tools.ld_eff2trd(3 /*ld_class*/, horizon.clay));
          // tools.soilCharacteristicsKA5(soilParameters);

          /* else use Saxton */
          var saxton = tools.saxton(horizon.sand, horizon.clay, horizon.organicMatter, horizon.sceleton).saxton_86;
          soilParameters.set_vs_SoilBulkDensity(roundN(2, saxton.BD));
          soilParameters.vs_FieldCapacity = roundN(2, saxton.FC);
          soilParameters.vs_Saturation = roundN(2, saxton.SAT);
          soilParameters.vs_PermanentWiltingPoint = roundN(2, saxton.PWP);

        }
        
        /* TODO: hinter readJSON verschieben */ 
        if (!soilParameters.isValid()) {
          ok = false;
          logger(MSG_ERROR, 'Error in soil parameters.');
        }

        layers.push(soilParameters);
        logger(MSG_INFO, 'Fetched layer ' + layers.length + ' in horizon ' + h + '.');

      }

      logger(MSG_INFO, 'Fetched horizon ' + h + '.');
    }  

    return ok;
  }


  function createProcesses(cropRotation, production, startDate) {
    
    var ok = true;
    var crops = production.crops;
    var cs = crops.length;
    
    logger(MSG_INFO, 'Fetching ' + cs + ' crops.');

    for (var c = 0; c < cs; c++) {

      var crop = crops[c];
      var isGrassland = (crop.model === 'grassland');
      /* assume perm. grassland if there is only one crop in the rotation array and sowing date has not been specified */
      var isPermanentGrassland = (isGrassland && cs === 1 && (crop.sowingDate === null || crop.sowingDate === undefined));

      if (isGrassland) {
        /* we can not start at day 0 and therefor start at day 0 + 2 since model's general step is executed *after* cropStep */
        var sd_ = new Date(startDate.toISOString());
        sd_.setDate(sd_.getDate() + 2);
        var sd = getValue(crop, 'sowingDate', sd_);
        var hds = getValue(crop, 'harvestDates', []);
      } else {
        var sd = new Date(Date.parse(crop.sowingDate));
        var hd = new Date(Date.parse(crop.finalHarvestDate));
        if (!sd.isValid() || !hd.isValid()) {
          ok = false;
          logger(MSG_ERROR, 'Invalid sowing or harvest date in ' + crop.name);
        }
      }

      if (isGrassland) {

        var grass = new Grass(sd, hds, crop.species, isPermanentGrassland);
        cropRotation[c] = new ProductionProcess('grassland', grass);

      } else {

        /* choose the first (and only) name in species array (mixtures not implemented in generic crop model) */
        var genericCrop = new GenericCrop(crop.species[0].name);
        genericCrop.setSeedAndHarvestDate(sd, hd);
        cropRotation[c] = new ProductionProcess(crop.name, genericCrop);
      
      }

      /* tillage */
      var tillageOperations = crop.tillageOperations;
      if (tillageOperations) { /* in case no tillage has been added */
        if (!addTillageOperations(cropRotation[c], tillageOperations)) {
          ok = false;
          logger(MSG_ERROR, 'Error adding tillages.');
        }
      }

      /* mineral fertilizer */
      var mineralFertilisers = crop.mineralFertilisers;
      if (mineralFertilisers) { /* in case no min fertilizer has been added */
        if (!addFertilizers(cropRotation[c], mineralFertilisers, false)) {
          ok = false;
          logger(MSG_ERROR, 'Error adding mineral fertilisers.');
        }
      }

      /* organic fertilizer */ 
      var organicFertilisers = crop.organicFertilisers;
      if (organicFertilisers) { /* in case no org fertilizer has been added */ 
        if (!addFertilizers(cropRotation[c], organicFertilisers, true)) {
          ok = false;
          logger(MSG_ERROR, 'Error adding organic fertilisers.');
        }
      }

      /* irrigations */
      var irrigations = crop.irrigations;
      if (irrigations) {  /* in case no irrigation has been added */
        if (!addIrrigations(cropRotation[c], irrigations)) {
          ok = false;
          logger(MSG_ERROR, 'Error adding irrigations.');
        }
      }

      /* cutting */
      var cuttings = crop.cuttings;
      if (cuttings) { /* in case no tillage has been added */
        if (!addCuttings(cropRotation[c], cuttings)) {
          ok = false;
          logger(MSG_ERROR, 'Error adding cuttings.');
        }
      }

      logger(MSG_INFO, 'Fetched crop ' + c + ': ' + crop.name);

    }

    return ok;
  }


  function addTillageOperations(productionProcess, tillageOperations) {

    var ok = true;
    var ts = tillageOperations.length;

    logger(MSG_INFO, 'Fetching ' + ts + ' tillages.');

    for (var t = 0; t < ts; ++t) {

      var till = tillageOperations[t];

      /* ignore if any value is null */
      if (till.date === null || till.depth === null || till.method === null) {
        logger(MSG_WARN, 'At least one tillage parameter null: tillage ' + t + ' ignored.');
        continue;
      }

      var tDate = new Date(Date.parse(till.date));
      var depth = till.depth / 100; // cm to m
      var method = till.method;

      if (!tDate.isValid()) {
        ok = false;
        logger(MSG_ERROR, 'Invalid tillage date in tillage no. ' + t + '.');
      }

      productionProcess.addApplication(new TillageApplication(tDate, depth));

      logger(MSG_INFO, 'Fetched tillage ' + t + '.');

    }

    return ok;
  }


  function addFertilizers(productionProcess, fertilizers, isOrganic) {
    // TODO: implement in JS
    /*
    //get data parsed and to use leap years if the crop rotation uses them
    Date fDateate = parseDate(sfDateate).toDate(it->crop()->seedDate().useLeapYears());

    if (!fDateate.isValid())
    {
      debug() << 'Error - Invalid date in \'' << pathToFile << '\'' << endl;
      debug() << 'Line: ' << s << endl;
      ok = false;
    }

   //if the currently read fertiliser date is after the current end
    //of the crop, move as long through the crop rotation as
    //we find an end date that lies after the currently read fertiliser date
    while (fDateate > currentEnd)
    {
      //move to next crop and possibly exit at the end
      it++;
      if (it == cr.end())
        break;

      currentEnd = it->end();

      //cout << 'new PP start: ' << it->start().toString()
      //<< ' new PP end: ' << it->end().toString() << endl;
      //cout << 'new currentEnd: ' << currentEnd.toString() << endl;
    }
    */
    var ok = true;
    var fs = fertilizers.length;

    logger(MSG_INFO, 'Fetching ' + fs + ' ' + (isOrganic ? 'organic' : 'mineral') + ' fertilisers.');

    for (var f = 0; f < fs; ++f) {
      
      var fertilizer = fertilizers[f];

      /* ignore if any value is null */
      if (fertilizer.date === null || fertilizer.method === null || fertilizer.amount === null) {
        logger(MSG_WARN, 'At least one fertiliser parameter null: ' + (isOrganic ? 'organic' : 'mineral') + ' fertiliser ' + f + 'ignored.');
        continue;
      }

      var fDate = new Date(Date.parse(fertilizer.date))
        , method = fertilizer.method
        , name = fertilizer.name // changed from id to name
        , amount = fertilizer.amount // [kg (FM) ha-1]
        , carbamid = fertilizer.carbamid
        , no3 = fertilizer.no3
        , nh4 = fertilizer.nh4
        , dm = fertilizer.dm
        ;

      if (!fDate.isValid()) {
        ok = false;
        logger(MSG_ERROR, 'Invalid fertilization date in ' + f + '.');
      }

      if (isOrganic)
        productionProcess.addApplication(new OrganicFertiliserApplication(fDate, new OrganicFertilizer(name, carbamid, no3, nh4, dm), amount, true));
      else
        productionProcess.addApplication(new MineralFertiliserApplication(fDate, new MineralFertilizer(name, carbamid, no3, nh4), amount));

      logger(MSG_INFO, 'Fetched ' + (isOrganic ? 'organic' : 'mineral') + ' fertiliser ' + f + '.');

    }
     
    return ok; 
  }


  function addIrrigations(productionProcess, irrigations) {
    
    var ok = true;

    // TODO: implement in JS
    //get data parsed and to use leap years if the crop rotation uses them
    /*Date idate = parseDate(irrDate).toDate(it->crop()->seedDate().useLeapYears());
    if (!idate.isValid())
    {
      debug() << 'Error - Invalid date in \'' << pathToFile << '\'' << endl;
      debug() << 'Line: ' << s << endl;
      debug() << 'Aborting simulation now!' << endl;
      exit(-1);
    }

    //cout << 'PP start: ' << it->start().toString()
    //<< ' PP end: ' << it->end().toString() << endl;
    //cout << 'irrigationDate: ' << idate.toString()
    //<< ' currentEnd: ' << currentEnd.toString() << endl;

    //if the currently read irrigation date is after the current end
    //of the crop, move as long through the crop rotation as
    //we find an end date that lies after the currently read irrigation date
    while (idate > currentEnd)
    {
      //move to next crop and possibly exit at the end
      it++;
      if (it == cr.end())
        break;

      currentEnd = it->end();

      //cout << 'new PP start: ' << it->start().toString()
      //<< ' new PP end: ' << it->end().toString() << endl;
      //cout << 'new currentEnd: ' << currentEnd.toString() << endl;
    }*/

    var is = irrigations.length;
    
    logger(MSG_INFO, 'Fetching ' + is + ' irrigations.');

    for (var i = 0; i < is; ++i) {
      
      var irrigation = irrigations[i];

      /* ignore if any value is null */
      if (irrigation.date === null || irrigation.method  === null || irrigation.eventType  === null || irrigation.threshold  === null
          || irrigation.amount === null || irrigation.NConc === null) {
        logger(MSG_WARN, 'At least one irrigation parameter null: irrigation ' + i + ' ignored.');
        continue;
      }

      var method = irrigation.method;
      var eventType = irrigation.eventType;
      var threshold = irrigation.threshold;
      var area = irrigation.area;
      var amount = irrigation.amount;
      var NConc = irrigation.NConc;
      var iDate = new Date(Date.parse(irrigation.date));

      if (!iDate.isValid()) {
        ok = false;
        logger(MSG_ERROR, 'Invalid irrigation date in ' + i + '.');
      }

      productionProcess.addApplication(new IrrigationApplication(iDate, amount, new IrrigationParameters(NConc, 0.0)));

      logger(MSG_INFO, 'Fetched irrigation ' + i + '.');

    }

    return ok;
  };

  /*
    JV: test new function
  */

  // function addCuttings(productionProcess, cutArr) {

  //   var ok = true;
  //   var cs = cutArr.length;

  //   logger(MSG_INFO, 'Fetching ' + cs + ' cuttings.');

  //   for (var c = 0; c < cs; ++c) {
  //     var cutObj = cutArr[c];
  //     var cDate = new Date(Date.parse(cutObj.date));
  //     pp.addApplication(new Cutting(cDate, pp.crop(), pp.cropResult()));
  //   }

  //   return ok;
  // };


  function createWeather(weather, input) {

    var ok = true;
    var data = [];

    data[WEATHER.TMIN] = new Float64Array(input.tmin);                  /* [°C] */
    data[WEATHER.TMAX] = new Float64Array(input.tmax);                  /* [°C] */
    data[WEATHER.TAVG] = new Float64Array(input.tavg);                  /* [°C] */
    data[WEATHER.GLOBRAD] = new Float64Array(input.globrad);            /* [MJ m-2] */
    data[WEATHER.WIND] = new Float64Array(input.wind);                  /* [m s-1] */
    data[WEATHER.PRECIP] = new Float64Array(input.precip);              /* [mm] */

    /* required for grassland model */
    data[WEATHER.DAYLENGTH] = new Float64Array(input.daylength);        /* [h] */
    data[WEATHER.F_DIRECTRAD] = new Float64Array(input.f_directrad);    /* [h h-1] fraction direct solar radiation */
    data[WEATHER.EXRAD] = new Float64Array(input.exrad);                /* [MJ m-2] */

    data[WEATHER.SUNHOURS] = new Float64Array(input.sunhours);          /* [h] */
    data[WEATHER.RELHUMID] = new Float64Array(input.relhumid);          /* [%] */

    data[WEATHER.DOY] = input.doy;
    data[WEATHER.ISODATESTRING] = input.date;

    /* check if all arrays are of the same length */
    var length = data[WEATHER.TMIN].length;
    for (var i in WEATHER) { 
      if (data[WEATHER[i]].length != length)
        ok = false;
    }
    
    if (ok)
      weather.setData(data);      

    /* TODO: add additional checks */

    return ok;

  };

  function defaultCallback(dayOfSimulation, dateString, models, done) {

    var progress = [];

    if (!done) {

      for (var m = 0; m < noModels; m++) {
        progress.push({
          date: { value: dateString, unit: '[date]' }
        });
      }

      // var isCropPlanted = model.isCropPlanted()
      //   , mcg = model.cropGrowth()
      //   , mst = model.soilTemperature()
      //   , msm = model.soilMoisture()
      //   , mso = model.soilOrganic()
      //   , msc = model.soilColumn()
      //   /* TODO: (from cpp) work-around. Hier muss was eleganteres hin! */
      //   , msa = model.soilColumnNC()
      //   , msq = model.soilTransport()
      //   ;

      // progress = {
      //     date: { value: date.toISOString(), unit: '[date]' }
      //   , CropName: { value: isCropPlanted ? mcg.name() : '', unit: '-' }
      //   , WaterStress: { value: isCropPlanted ? mcg.waterStress() : 0, unit: '[0;1]' }
      //   , Transpiration: { value: isCropPlanted ? mcg.transpiration() : 0, unit: '[mm]' } 
      //   , NitrogenStress: { value: isCropPlanted ? mcg.nitrogenStress() : 0, unit: '[0;1]' }
      //   , HeatStress: { value: isCropPlanted ? mcg.heatStress() : 0, unit: '[0;1]' }
      //   , OxygenStress: { value: isCropPlanted ? mcg.oxygenStress() : 0, unit: '[0;1]' }
      //   , DevelopmentalStage: { value: isCropPlanted ? mcg.developmentalStage() + 1 : 0, unit: '[#]' }
      //   , CurrentTemperatureSum: { value: isCropPlanted ? mcg.currentTemperatureSum() : 0, unit: '°C' }
      //   , DaylengthFactor: { value: isCropPlanted ? mcg.get_DaylengthFactor() : 0, unit: '[0;1]' }
      //   , GrowthIncrementRoot: { value: isCropPlanted ? mcg.growthIncrement(0) : 0, unit: '[kg (DM) ha-1]' }
      //   , GrowthIncrementLeaf: { value: isCropPlanted ? mcg.growthIncrement(1) : 0, unit: '[kg (DM) ha-1]' }
      //   , GrowthIncrementShoot: { value: isCropPlanted ? mcg.growthIncrement(2) : 0, unit: '[kg (DM) ha-1]' }
      //   , GrowthIncrementFruit: { value: isCropPlanted ? mcg.growthIncrement(3) : 0, unit: '[kg (DM) ha-1]' }
      //   , RelativeTotalDevelopment: { value: isCropPlanted ? mcg.relativeTotalDevelopment() : 0, unit: '[0;1]' }
      //   , BiomassRoot: { value: isCropPlanted ? mcg.biomass(0) : 0, unit: '[kg (DM) ha-1]' }
      //   , BiomassLeaf: { value: isCropPlanted ? mcg.biomass(1) : 0, unit: '[kg (DM) ha-1]' }
      //   , BiomassShoot: { value: isCropPlanted ? mcg.biomass(2) : 0, unit: '[kg (DM) ha-1]' }
      //   , BiomassFruit: { value: isCropPlanted ? mcg.biomass(3) : 0, unit: '[kg (DM) ha-1]' }
      //   , PrimaryYieldDryMatter: { value: isCropPlanted ? mcg.primaryYieldDryMatter() : 0, unit: '[kg (DM) ha-1]' }
      //   , LeafAreaIndex: { value:  isCropPlanted ? mcg.leafAreaIndex() : 0, unit: '[m-2 m-2]' }
      //   , NetPhotosynthesis: { value: isCropPlanted ? mcg.netPhotosynthate() : 0, unit: '[kg (CH2O) ha-1 d-1]' }
      //   , StomataResistance: { value: isCropPlanted ? mcg.stomataResistance() : 0, unit: '[s m-1]' }
      //   , CropHeight: { value: isCropPlanted ? mcg.height() : 0, unit: '[m]' }
      //   , RootingDepth: { value: isCropPlanted ? mcg.rootingDepth() : 0, unit: '[layer #]' }
      //   , ShootBiomass: { value: isCropPlanted ? mcg.shootBiomass() : 0, unit: '[kg ha-1]' }
      //   , AccumulatedNitrogenUptake: { value: isCropPlanted ? mcg.accumulatedNitrogenUptake() : 0, unit: '[kg (N) m-2]' }
      //   , NitrogenUptake: { value: isCropPlanted ? mcg.nitrogenUptake() : 0, unit: '[kg (N)  m-2]' }
      //   , PotentialNitrogenUptake: { value: isCropPlanted ? mcg.potentialNitrogenUptake() : 0, unit: '[kg (N)  m-2]' }
      //   , ShootBiomassNitrogenConcentration: { value: isCropPlanted ? mcg.shootBiomassNitrogenConcentration() : 0, unit: '[kg (N) kg-1 (DM)]' }
      //   , NetPrimaryProduction: { value: isCropPlanted ? mcg.netPrimaryProduction() : 0, unit: '[kg (N) ha-1]' }
      // };

      // var outLayers = 20;

      // for (var i_Layer = 0; i_Layer < outLayers; i_Layer++)
      //   progress['SoilMoisture_' + i_Layer] = { value: msm.get_SoilMoisture(i_Layer), unit: '[m-3 m-3]' };

      // progress['dailySumIrrigationWater'] = { value: model.dailySumIrrigationWater(), unit: '[mm]' };
      // progress['Infiltration'] = { value: msm.get_Infiltration(), unit: '[mm]' };
      // progress['SurfaceWaterStorage'] = { value: msm.get_SurfaceWaterStorage(), unit: '[mm]' };
      // progress['SurfaceRunOff'] = { value: msm.get_SurfaceRunOff(), unit: '[mm]' };
      // progress['SnowDepth'] = { value: msm.get_SnowDepth(), unit: '[mm]' }; 
      // progress['FrostDepth'] = { value: msm.get_FrostDepth(), unit: '[mm]' };
      // progress['ThawDepth'] = { value: msm.get_ThawDepth(), unit: '[mm]' };

      // for (var i_Layer = 0; i_Layer < outLayers; i_Layer++)
      //  progress['PASW_' + i_Layer] = { value: msm.get_SoilMoisture(i_Layer) - msa[i_Layer].get_PermanentWiltingPoint(), unit: '[m-3 m-3]' };

      // progress['SoilSurfaceTemperature'] = { value: mst.get_SoilSurfaceTemperature(), unit: '[°C]' };

      // for(var i_Layer = 0; i_Layer < 5; i_Layer++)
      //   progress['SoilTemperature_' + i_Layer] = { value: mst.get_SoilTemperature(i_Layer), unit: '[°C]' };

      // progress['ActualEvaporation'] = { value: msm.get_ActualEvaporation(), unit: '[mm]' };
      // progress['Evapotranspiration'] = { value: msm.get_Evapotranspiration(), unit: '[mm]' };
      // progress['ET0'] = { value: msm.get_ET0(), unit: '[mm]' };
      // progress['KcFactor'] = { value: msm.kcFactor(), unit: '[?]' };
      // progress['AtmosphericCO2Concentration'] = { value: model.get_AtmosphericCO2Concentration(), unit: '[ppm]' };
      // progress['GroundwaterDepth'] = { value: model.get_GroundwaterDepth(), unit: '[m]' };
      // progress['GroundwaterRecharge'] = { value: msm.get_GroundwaterRecharge(), unit: '[mm]' };
      // progress['NLeaching'] = { value: msq.get_NLeaching(), unit: '[kg (N) ha-1]' };

      // for(var i_Layer = 0; i_Layer < outLayers; i_Layer++)
      //   progress['SoilNO3_' + i_Layer] = { value: msc.soilLayer(i_Layer).get_SoilNO3(), unit: '[kg (N) m-3]' };

      // progress['SoilCarbamid'] = { value: msc.soilLayer(0).get_SoilCarbamid(), unit: '[kg (N) m-3]' };

      // for(var i_Layer = 0; i_Layer < outLayers; i_Layer++)
      //   progress['SoilNH4_' + i_Layer] = { value: msc.soilLayer(i_Layer).get_SoilNH4(), unit: '[kg (N) m-3]' };

      // for(var i_Layer = 0; i_Layer < 4; i_Layer++)
      //   progress['SoilNO2_' + i_Layer] = { value: msc.soilLayer(i_Layer).get_SoilNO2(), unit: '[kg (N) m-3]' };

      // for(var i_Layer = 0; i_Layer < 6; i_Layer++)
      //   progress['SoilOrganicCarbon_' + i_Layer] = { value: msc.soilLayer(i_Layer).vs_SoilOrganicCarbon(), unit: '[kg (C) kg-1]' };

    }
  
    if (ENVIRONMENT_IS_WORKER)
      postMessage({ progress: progress });
    else {
      console.log(JSON.stringify(progress, null, 2));  
    }

    if (done) 
      logger(MSG_INFO, 'done');
  
  };  

  return {
    run: run 
  };


};
