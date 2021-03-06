/*
  Copywrite (c) 2015 Jan Vaillant (jan.vaillant@zalf.de)


  REFERENCES

  Johnson I. R. , Lodge G. M. , White R. E. (2003) The Sustainable Grazing Systems Pasture Model: description, philosophy 
  and application to the SGS National Experiment. Australian Journal of Experimental Agriculture 43 , 711–728.

  Johnson IR (2008). Biophysical pasture model documentation: model documentation for DairyMod. EcoMod and the SGS Pasture
  Model. (IMJ Consultants: Dorrigo, NSW)

  Johnson IR (2013). DairyMod and the SGS Pasture Model: a mathematical description of the biophysical model structure.
  IMJ Consultants, Dorrigo, NSW, Australia.


  README

  - Ideally the model should implement phenology routines describing e.g. mean stage count (MSC), leaf appearance rate etc.. 
    But no phenology model applicable to a wide range of species and geographic locations seem to exist. Therefore the model 
    is unaware of any phenological development exept a GDD based flowering date which is simply a proxy for the turing point 
    of photosynthate partitiong to leafs (i.e. max LAI reached and partitioning to leaf <= 0.5): If the mixture
    is not harvested till flowering the output of the model is more or less meaningless.

  Important (somewhat experimental or missing feature) deviations from the original approach:

  - For consistency NH4 uptake was removed (implemented in SGS) because it is not implemented in MONICA's generic crops.
  - Annual species not implemented.
  - New tissue composition if nitrogen uptake is not sufficient to satisfy 'demand'. 
  - Light competiotion disabled (P_g_mix) due to errors in implementation.
  - Height function disabled: Instead of species specific hight only mixture height


  TODO

  - fix P_g. There is a small difference in P_g and P_g_mix. Check initial lai layer depth.
  - tests with N-Ireland ryegrass data suggest that growthg is systematically under-(over)-estimated in spring (autum).
    Potential solution: There is currently no ("locked") pool to accumulate reserves in autum stored in roots (or in 
    case of clover above the root) that will be released in spring to support initial growth.
*/

var GrasslandGrowth = function (sc, gps, mixture, stps, cpp) { // takes additional grassland param

  var soilColumn = sc
    , generalParams = gps
    , centralParameterProvider = cpp
    , numberOfSpecies = mixture.length
    , ρ_stock = 0 /* [animals ha-1] stocking rate */
    // , homogeneity = mixture.homogeneity
    , vs_NumberOfLayers  = sc.vs_NumberOfLayers()
    , vs_NumberOfOrganicLayers  = sc.vs_NumberOfOrganicLayers()
    , vs_LayerThickness = soilColumn.vs_LayerThickness()
    , vs_Latitude  = stps.vs_Latitude
    , vs_HeightNN = stps.vs_HeightNN
    , vc_InterceptionStorage = 0.0
    , vc_accumulatedETa = 0
    , pc_NitrogenResponseOn = gps.pc_NitrogenResponseOn
    , waterDeficitResponseOn = gps.pc_WaterDeficitResponseOn
    , lowTemperatureStressResponseOn = gps.pc_LowTemperatureStressResponseOn
    , highTemperatureStressResponseOn = gps.pc_HighTemperatureStressResponseOn
    , vc_NetPrecipitation = 0
    , vc_InterceptionStorage = 0
    , vc_ReferenceEvapotranspiration = 0
    , vc_PotentialEvapotranspiration = 0
    , vc_PotentialTranspiration = 0
    , vc_RemainingEvapotranspiration = 0
    , vc_EvaporatedFromIntercept = 0
    , vc_KcFactor = 0.4 // TODO: source?
    , vc_StomataResistance = 0
    ;

  var keepalive = true;    // a workaround to increase a species chance of survival and prevent a complete disappearance
  var DM_shoot_min = 0.01; // [kg (DM) m-2]


  /* initialize arrays */
  for (var s = 0; s < numberOfSpecies; s++) {
    mixture.f_r[s] = [];
    mixture.W_r[s] = [];
    mixture.N_up[s] = [];
    mixture.E_T[s] = [];
    mixture.f_r_sum[s] = 0;
    for (var i_Layer = 0; i_Layer < vs_NumberOfLayers; i_Layer++) {
      mixture.f_r[s][i_Layer] = 0;
      mixture.W_r[s][i_Layer] = 0;
      mixture.N_up[s][i_Layer] = 0;
      mixture.E_T[s][i_Layer] = 0;
    }
  }
  for (var i_Layer = 0; i_Layer < vs_NumberOfLayers; i_Layer++) {
    mixture.W_r_sum[i_Layer] = 0;
    mixture.N_up_sum[i_Layer] = 0;
  }


  /*
    (3.58ff) cumulative low and high temperature stress function 

    T     [C°]  mean daily temperature
    T_mn  [C°]  minimum daily temperature
    T_mx  [C°]  maximum daily temperature
  */
  
  function highAndLowTempStress(T, T_mn, T_mx) {
    
    for (var s = 0; s < numberOfSpecies; s++) {

      var species = mixture[s]
        , vars = species.vars
        , cons = species.cons
        , T_mn_high = cons.T_mn_high
        , T_mn_low = cons.T_mn_low
        , T_mx_high = cons.T_mx_high
        , T_mx_low = cons.T_mx_low
        , ξ_T_low = 1.0               // [0-1]  low temperature stress coefficient      
        , ξ_T_high = 1.0              // [0-1]  low temperature stress coefficient     
        ;

      /* low temp. stress and recovery */
      if (lowTemperatureStressResponseOn) {
        if (T_mn < T_mn_high) {
        
          if (T_mn <= T_mn_low)
            ξ_T_low = 0;
          else
            ξ_T_low = (T_mn - T_mn_low) / (T_mn_high - T_mn_low);

          vars.τ_T_low *= ξ_T_low;
        
        } else {

          vars.ζ_T_low += T / cons.T_sum_low;
          vars.τ_T_low = min(1, vars.τ_T_low + vars.ζ_T_low);
          if (vars.τ_T_low === 1) // full recovery
            vars.ζ_T_low = 0;
        
        }
      }

      /* heigh temp. stress and recovery */
      if (highTemperatureStressResponseOn) {
        if (T_mx > T_mx_low) {
        
          if (T_mx >= T_mx_high)
            ξ_T_high = 0;
          else
            ξ_T_high = (T_mx - T_mx_low) / (T_mx_high - T_mx_low);

          vars.τ_T_high *= ξ_T_high;
        
        } else {

          vars.ζ_T_high += max(0, 25 - T) / cons.T_sum_high;
          vars.τ_T_high = min(1, vars.τ_T_high + vars.ζ_T_high);
          if (vars.τ_T_high === 1) // full recovery
            vars.ζ_T_high = 0;
        
        }
      }

    }

  } // highAndLowTempStress


  /*
    Daily canopy gross photosynthesis in response to irradiance
    
    P_g_day       [kg (C) m-2 d-1]  gross photosynthesis

    T             [C°]              mean daily temperature
    T_mn          [C°]              minimum daily temperature
    T_mx          [C°]              maximum daily temperature
    PPF           [μmol m-2 d-1]    photosynthetic photon flux
    τ             [s]               daylength
    C_amb         [μmol mol-1]      CO2 concentration
    f_s           [-]               fraction direct solar radiation
  */  
  function grossPhotosynthesis(T, T_mn, T_mx, PPF, τ, C_amb, f_s) {

     // var P_g_day_mix = [];
     var P_g_day = [];
     /* (1 - mixture.homogeneity) LAI covers (1 - mixture.homogeneity) / numberOfSpecies m-2 */
     // var L_scale = (numberOfSpecies === 1 ? 1 : (1 - mixture.homogeneity) / ((1 - mixture.homogeneity) / numberOfSpecies));

    /*
      (4.8b) Diurnal variation (distribution) in irradiance (I) and temperature (T) 
      This is a simplified calculation from Johnson 2005 (2008). Could be any distribution.

      R_s = PPF

      maximum irradiance within a day for 1/2 τ
      I_mx = 4/3 * R_s/τ
      irradiance during in- and decreasing irradiance within a day = 1/2 I_mx
      I_mn = 1/2 I_mx = 2/3 * R_s/τ

      R_s = (1/2 * τ * I_mx) + (x * τ * 1/2 * I_mx)
      R_s = (2/3 * R_s) + (x * 2/3 * R_s) <=> x = 1/2
      R_s = (1/2 * τ * I_mx) + (1/4 * τ * I_mx) <=> τ/2 * (I_mx + I_mx/2) <=> τ/2 * (I_mx + I_mn)

      temperature during max. irradiance within a day  
      T_I_mx = (T_mx + T_mean) / 2
      temperature during 1/2 max. irradiance within a day
      T_I_mn = T_mean

      (τ / 2) * P_g(I_mx, T_I_mx, N) [mg CO2 m-2 day-1] daily gross photosynthesis during max irradiance
      (τ / 2) * P_g(I_mn, T_I_mn, N) [mg CO2 m-2 day-1] daily gross photosynthesis during min irradiance
    */

    var I_mx = (4 / 3) * (PPF / τ)
      , I_mn = (1 / 2) * I_mx
      , T_I_mx = (T_mx + T) / 2
      , T_I_mn = T
      ;

    /* light competition disabled. needs to be fixed */
    if (1 /*numberOfSpecies > 1*/) { 

      // array
      // P_g_day_mix = P_g_mix(I_mx, I_mn, T_I_mx, T_I_mn, f_s, C_amb);
      // if (mixture.homogeneity < 1)
        P_g_day = P_g(I_mx, I_mn, T_I_mx, T_I_mn, f_s, C_amb/*, L_scale*/);
      // if (DEBUG) {
      //   debug('P_g_day', P_g_day);
      //   for (var s = 0; s < numberOfSpecies; s++) {
      //     if (sum(P_g_day) / numberOfSpecies != P_g_day[s])
      //       throw new Error ('sum(P_g_day) / numberOfSpecies != P_g_day[s]');
      //   }
      // }

      /* iterate over mixture array */
      for (var s = 0; s < numberOfSpecies; s++) {

        var vars = mixture[s].vars;
        vars.GLF = vars.Ω_water * sqrt(vars.Ω_N) * vars.τ_T_low * vars.τ_T_high // combined growth limiting factors
        vars.P_g_day = 0;

        /* (3.37) conversion of μmol CO2 to mol (1e-6) and mol CO2 to kg C (0.012) mixture[s].vars.Ω_water * sqrt(mixture[s].vars.Ω_N) missing in Johnson (2013) */
        // mixture[s].vars.P_g_day += (44 * 12 / 44 * 1e-3) * 1e-6 * (τ / 2) * P_g_day_mix[s] * vars.GLF * f_area_mix /* * mixture.homogeneity*/;
        // if (mixture.homogeneity < 1)
          mixture[s].vars.P_g_day += (44 * 12 / 44 * 1e-3) * 1e-6 * (τ / 2) * P_g_day[s] * vars.GLF /* / L_scale * (1 - mixture.homogeneity)*/;

      }

    }
    // else {

    //   P_g_day = P_g(I_mx, I_mn, T_I_mx, T_I_mn, f_s, C_amb/*, L_scale*/);
    //   // P_g_day = P_g_mix(I_mx, I_mn, T_I_mx, T_I_mn, f_s, C_amb);

    //   var vars = mixture[0].vars;
    //   vars.GLF = vars.Ω_water * sqrt(vars.Ω_N) * vars.τ_T_low * vars.τ_T_high // combined growth limiting factors

    //   /* (3.37) conversion of μmol CO2 to mol (1e-6) and mol CO2 to kg C (0.012) Ω_water missing in Johnson (2013) */
    //   mixture[0].vars.P_g_day = (44 * 12 / 44 * 1e-3) * 1e-6 * (τ / 2) * P_g_day[0] * vars.GLF;

    // }

    /*
      (1.16) CO2 response function
  
      Takes unity at C_amb_ref, λ at double C_amb_ref and f_C_m at C -> ∞
  
      TODO: calculation of parameters required only once: move somewhere else 
      
      f_C   [-]           scale factor
      C     [μmol mol-1]  ambient CO2 concentration
      λ     [-]           f_C at double C_amb_ref
      f_C_m [-]           f_C at saturating C
    */
    
    function f_C(C, λ, f_C_m) {
  
      // check (1.21)
      if (f_C_m >= λ / (2 - λ)) {
        f_C_m = λ / (2 - λ) - 1e-10; // make sure it is smaller
        logger(MSG_WARN, 'Adjusted f_C_m to ' + f_C_m + ' since f_C_m >= λ / (2 - λ)');
      }
  
      var f_C = 1
        , C_amb_ref = 380
        , Φ = (f_C_m * (λ * (f_C_m - 1) - 2 * (f_C_m - λ))) / (pow(λ, 2) * (f_C_m - 1) - 2 * (f_C_m - λ))
        , β = (λ * (f_C_m - Φ * λ)) / (2 * C_amb_ref * (f_C_m - λ))
        ;
  
      f_C = 1 / (2 * Φ) * (β * C + f_C_m - sqrt(pow(β * C + f_C_m, 2) - 4 * Φ * β * f_C_m * C));
  
      return f_C;
  
    }


    /*
      (3.14) N response function

      f_N [kg (N) kg-1 (C)] nitrogen fraction
    */

    function f_Pm_N(f_N, f_N_ref) {

      return min(1, f_N / f_N_ref); 

    }


    /*
      (3.16 ff) Combiend T & CO2 response function

      T   [°C]
      C_amb [μmol mol-1]  ambient CO2 concentration
    */

    function f_Pm_TC(T, C_amb, γ_Pm, T_mn, T_ref, T_opt_Pm_amb, isC4, λ, f_C_m) {

      var f_Pm_TC = 0
        , q = 2 // TODO: value? (vgl. S. 12, Johnson 2013)
        , T_opt_Pm = T_opt_Pm_amb + γ_Pm * (f_C(C_amb, λ, f_C_m) - 1)
        , T_mx = ((1 + q) * T_opt_Pm - T_mn) / q
        ;

      /* (1.40) constrain */
      if (T_ref > T_opt_Pm)
        T_ref = T_opt_Pm;

      /* C4 species constraint ..  "so that the temperature response does not fall when temperatures exceed the optimum." S. 45 */
      T  = (isC4 && T > T_opt_Pm) ? T_opt_Pm : T; 

      if (T <= T_mn || T >= T_mx)
        f_Pm_TC = 0;
      else
        f_Pm_TC = pow((T - T_mn) / (T_ref - T_mn), q) * (((1 + q) * T_opt_Pm - T_mn - q * T) / ((1 + q) * T_opt_Pm - T_mn - q * T_ref));

      return f_Pm_TC; 

    }


    /*
      (3.25 ff) Combiend T & CO2 response function

      T     [°C]
      C_amb [μmol mol-1]  ambient CO2 concentration
    */

    function f_α_TC(T, C_amb, λ_α, γ_α, λ, f_C_m) {

      var f_α_TC = 0
        , C_amb_ref = 380
        , T_opt_α = 15 + γ_α * (f_C(C_amb, λ, f_C_m) - 1)
        ;

      f_α_TC = (T < T_opt_α) ? 1 : (1 - λ_α * (C_amb_ref / C_amb) * (T - T_opt_α));  

      return f_α_TC; 

    }


    /*
      (3.29) N response function
  
      f_α_N

      f_N [kg (N) kg-1 (C)] nitrogen fraction
    */

    function f_α_N(f_N, f_N_ref) {

      var f_α_N = 0;

      f_α_N = (f_N > f_N_ref) ? 1 : (0.5 + 0.5 * (f_N / f_N_ref));

      return f_α_N; 

    }

    
    /*
      P_l [μmol (CO2) m-2 (leaf) s-1] rate of single leaf gross photosynthesis in response to incident PPF

      I   [μmol (photons) m-2 s-1]    incident solar radiation
      α   []
      P_m []
      ξ   []
    */
    
    function P_l(I_l, α, P_m, ξ) {

      var P_l = 0; 

      P_l = 1 / (2 * ξ) * (α * I_l + P_m - sqrt(pow(α * I_l  + P_m, 2) - 4 * ξ * α * I_l * P_m));

      return P_l;

    }

    
    /*
      (3.33, 3.101 ff) Canopy gross photosynthesis in mixed swards including photorespiration

      P_g [μmol (CO2) m-2 s-1]      instantaneous canopy gross photosynthesis
      
      I_0 [μmol (photons) m-2 s-1]  incident solar radiation on the canopy
      T   [°C]                      temperature
      f_s [-]                       fraction direct solar radiation
      C_amb
    */
    
    function P_g_mix(I_mx, I_mn, T_I_mx, T_I_mn, f_s, C_amb) {

      var P_g = [] // return values 
        , n_L = mixture.n_L()
        , n_start_p = mixture.n_start_p(n_L) // array
        , δL_p = mixture.δL_p(n_start_p, n_L)
        , δL_i = mixture.δL_i(n_start_p, n_L, δL_p)
        , k_e_i = mixture.k_e_i(n_L, n_start_p, δL_p)
        , α_mx = []
        , α_mn = []
        , P_m_mx = []
        , P_m_mn = []
        , ξ = []
        , k = []
        ;

      // var _EX_δL_p = mixture._EX_δL_p(n_L)
      //   , _EX_δL_i = mixture._EX_δL_i(n_L, _EX_δL_p)
      //   , _EX_k_e_i = mixture._EX_k_e_i(n_L, _EX_δL_p)
      //   ;

      // debug('_EX_δL_p', _EX_δL_p);
      // debug('_EX_δL_i', _EX_δL_i);
      // debug('_EX_k_e_i', _EX_k_e_i);

      var I_s_mx = I_mx * f_s
        , I_s_mn = I_mn * f_s
        , I_d_mx = I_mx * (1 - f_s)
        , I_d_mn = I_mn * (1 - f_s)
        ;

      /* iterate over species */
      for (var s = 0; s < numberOfSpecies; s++) {

        P_g[s] = 0;

        var species = mixture[s] 
          , cons = species.cons
          , photo = cons.photo
          , α_amb_15 = photo.α_amb_15
          , P_m_ref = photo.P_m_ref
          , isC4 = species.isC4
          , λ_α = photo.λ_α
          , γ_α = photo.γ_α
          , γ_Pm = photo.γ_Pm // TODO: value?
          , T_mn = photo.T_mn
          , T_ref = photo.T_ref
          , T_opt_Pm_amb = photo.T_opt_Pm_amb
          , λ = photo.λ
          , f_C_m = photo.f_C_m
          , f_N = species.N_live_leaf() / species.C_live_leaf() // TODO: canopy or leaf?
          , f_N_ref = cons.N_leaf.ref // TODO: fixed?
          ;

        k[s] = photo.k;
        ξ[s] = photo.ξ;

        /* (3.23) Photosynthetic efficiency, α */
        if (isC4) {
          α_mx[s] = a_mn[s] = α_amb_15 * f_C(C_amb, λ, f_C_m) * f_α_N(f_N, f_N_ref);
        } else {
          α_mx[s] = α_amb_15 * f_C(C_amb, λ, f_C_m) * f_α_TC(T_I_mx, C_amb, λ_α, γ_α, λ, f_C_m) * f_α_N(f_N, f_N_ref);
          α_mn[s] = α_amb_15 * f_C(C_amb, λ, f_C_m) * f_α_TC(T_I_mn, C_amb, λ_α, γ_α, λ, f_C_m) * f_α_N(f_N, f_N_ref);
        }

        /* (3.8) Light saturated photosynthesis, P_m. TODO: why not related to light extiction (exp(-kl)) any more? */
        P_m_mx[s] = P_m_ref * f_C(C_amb, λ, f_C_m) * f_Pm_TC(T_I_mx, C_amb, γ_Pm, T_mn, T_ref, T_opt_Pm_amb, isC4, λ, f_C_m) * f_Pm_N(f_N, f_N_ref);
        P_m_mn[s] = P_m_ref * f_C(C_amb, λ, f_C_m) * f_Pm_TC(T_I_mn, C_amb, γ_Pm, T_mn, T_ref, T_opt_Pm_amb, isC4, λ, f_C_m) * f_Pm_N(f_N, f_N_ref);

      } // for s

      /*  
          numerical integration:
        - iterate through the depth of the canopy of species.
        - if a new species appears in layer i (i >= n_start_p[s]) LAI increment 
          increases by δL_p and k_e_i (weighted k) changes
        - the fraction of leafs in direct light declines through the depth of 
          the canopy: exp(-k * l). The fraction in diffuse light increases: 1 - exp(-k * l)
        - the fraction in direct light is always also in diffuse light (2.21) 
      */

      var I_s_l_mx = 0
        , I_s_l_mn = 0
        , I_d_l_mx = 0
        , I_d_l_mn = 0
        , L_s = 1
        , L_d = 0
        ;

      /* iterate over leaf area layers */
      for (var i = 1; i <= n_L; i++) {


        /* include species s in integeration if s has occured in layer i */
        for (var s = 0; s < numberOfSpecies; s++) {
          
          if (n_start_p[s] <= i) {

            I_s_l_mx = k[s] * (I_s_mx + I_d_mx);
            I_s_l_mn = k[s] * (I_s_mn + I_d_mn);
            I_d_l_mx = k[s] * I_d_mx;
            I_d_l_mn = k[s] * I_d_mn;

            P_g[s] += P_l(I_s_l_mx, α_mx[s], P_m_mx[s], ξ[s]) * L_s * δL_p[s];
            P_g[s] += P_l(I_s_l_mn, α_mn[s], P_m_mn[s], ξ[s]) * L_s * δL_p[s];
            P_g[s] += P_l(I_d_l_mx, α_mx[s], P_m_mx[s], ξ[s]) * L_d * δL_p[s];
            P_g[s] += P_l(I_d_l_mn, α_mn[s], P_m_mn[s], ξ[s]) * L_d * δL_p[s];

          } // if s in i

        
        } // for s

        /* diffuse light at layer i+1 */
        I_d_mx = I_d_mx * (1 - k_e_i[i] * δL_i[i]);
        I_d_mn = I_d_mn * (1 - k_e_i[i] * δL_i[i]);

        /* fraction leaves in direct light */
        L_s = L_s * (1 - k_e_i[i] * δL_i[i]);
        /* fraction leaves only in diffuse light */
        L_d = 1 - L_s;

      } // for i

      return P_g;
      
    } // P_g_mix


    function P_g(I_mx, I_mn, T_I_mx, T_I_mn, f_s, C_amb) {

      var P_g = []; // return values 

      /* iterate over species */
      for (var s = 0; s < numberOfSpecies; s++) {

        P_g[s] = 0;

        var species = mixture[s] 
          , cons = species.cons
          , photo = cons.photo
          , α_amb_15 = photo.α_amb_15
          , P_m_ref = photo.P_m_ref
          , k = photo.k
          , isC4 = species.isC4
          , α = 0
          , P_m = 0
          , ξ = photo.ξ
          , λ_α = photo.λ_α
          , γ_α = photo.γ_α
          , γ_Pm = photo.γ_Pm
          , T_mn = photo.T_mn
          , T_ref = photo.T_ref
          , T_opt_Pm_amb = photo.T_opt_Pm_amb
          , λ = photo.λ
          , f_C_m = photo.f_C_m
          , f_N = species.f_N_live_leaf()
          , f_N_ref = cons.N_leaf.ref
          , LAI = species.L()
          ;

        /* (3.23) Photosynthetic efficiency, α */
        var α_mx = α_amb_15 * f_C(C_amb, λ, f_C_m) * f_α_N(f_N, f_N_ref);
        var α_mn = α_amb_15 * f_C(C_amb, λ, f_C_m) * f_α_N(f_N, f_N_ref);
        if (!isC4) {
          α_mx = α_mx * f_α_TC(T_I_mx, C_amb, λ_α, γ_α, λ, f_C_m);
          α_mn = α_mx * f_α_TC(T_I_mn, C_amb, λ_α, γ_α, λ, f_C_m);
        }

        /* (3.8) Light saturated photosynthesis, P_m. TODO: why not related to light extiction (exp(-kl)) any more? */
        var P_m_mx = P_m_ref * f_C(C_amb, λ, f_C_m) * f_Pm_TC(T_I_mx, C_amb, γ_Pm, T_mn, T_ref, T_opt_Pm_amb, isC4, λ, f_C_m) * f_Pm_N(f_N, f_N_ref);
        var P_m_mn = P_m_ref * f_C(C_amb, λ, f_C_m) * f_Pm_TC(T_I_mn, C_amb, γ_Pm, T_mn, T_ref, T_opt_Pm_amb, isC4, λ, f_C_m) * f_Pm_N(f_N, f_N_ref);

        var Δ_l = 0.1;
        var n = LAI / Δ_l;

        for (var i = 1; i <= n; i++) {
          
          var l_i = (2 * i - 1) * Δ_l / 2;
          
          /* direct (s) and diffuse (d) radiation */
          var I_l_mx_s = k * I_mx * (f_s + (1 - f_s) * exp(-k * l_i));
          var I_l_mx_d = k * I_mx * (1 - f_s) * exp(-k * l_i);
          var I_l_mn_s = k * I_mn * (f_s + (1 - f_s) * exp(-k * l_i));
          var I_l_mn_d = k * I_mn * (1 - f_s) * exp(-k * l_i);
          
          P_g[s] += P_l(I_l_mx_s, α_mx, P_m_mx, ξ) * exp(-k * l_i) * Δ_l;
          P_g[s] += P_l(I_l_mx_d, α_mx, P_m_mx, ξ) * (1 - exp(-k * l_i)) * Δ_l;
          P_g[s] += P_l(I_l_mn_s, α_mn, P_m_mn, ξ) * exp(-k * l_i) * Δ_l;
          P_g[s] += P_l(I_l_mn_d, α_mn, P_m_mn, ξ) * (1 - exp(-k * l_i)) * Δ_l;
          
        }

      } // for s

      return P_g;

    } // P_g

  } // grossPhotosynthesis


  /* 
    Daily carbon fixation

    requires: N [kg m-2] availability from uptake, remobilization and fixation

    - reduce gross assimilates by maintenance respiration and N uptake&fixation cost
    - if gross assilmilates are not sufficient to satisfy bowth i.e. P_growth < 0 reduce
      non-structrural C pools

    TODO: N-response switch


  */
  function netPhotosynthesis(T) {

    /* iterate over mixture array */
    for (var s = 0, ps = numberOfSpecies; s < ps; s++) {

      var species = mixture[s]
        , vars = species.vars
        , cons = species.cons
        , f_N = species.f_N_live_shoot()
        , P_g_day = vars.P_g_day
        , C_total = species.C_live_shoot() + species.C_root()
        , N_avail = species.vars.N_avail
        , isC4 = species.isC4
        , isLegume = species.isLegume
        ;

      // vars.R_m = R_m(T, species.N_live_shoot() / species.C_live_shoot(), cons.N_leaf.ref, C_total);
      var C_live_leaf = species.C_live_leaf()
        , N_live_leaf = species.N_live_leaf()
        , C_live_stem = species.C_live_stem()
        , N_live_stem = species.N_live_stem()
        , C_root = species.C_root()
        , N_root = species.N_root()
        ;
      vars.R_m = R_m(T, N_live_leaf / C_live_leaf, cons.N_leaf.ref, C_live_leaf);
      vars.R_m += R_m(T, N_live_stem / C_live_stem, cons.N_leaf.ref * 0.5, C_live_stem);
      // vars.R_m += R_m(T, N_root / C_root, cons.N_leaf.ref * 0.5, C_root); // TODO: root maint. resp.?

      vars.R_N = R_N(species.vars.N_up, species.vars.N_fix);
      
      /*(3.57) Gross assimilation P_g_day adjusted for maintenance respiration, 
      respiratory costs of nitrogen uptake and fixation. Use R_N from previous day (circularity) */
      var P_growth = P_g_day - vars.R_m - vars.R_N;

      if (P_growth > 0) {

        /* update partitioning coefficients */
        var ρ_l = vars.ρ_l
          , ρ_s = 1 - ρ_l
          , ρ_shoot = cons.part.ρ_shoot_ref * sqrt(vars.Ω_water * vars.Ω_N) /* based on previous day values! */
          , ρ_root = 1 - ρ_shoot
          , N_req = 0
          , N_assim = 0 // sum all organs [kg N m-2]
          , N_fix = 0
          , N_ref_opt = cons.N_leaf.opt
          , N_ref_max = cons.N_leaf.max
          ;

        vars.ρ_shoot = ρ_shoot;
        vars.ρ_root = ρ_root;

        /*
          if N conc. for any tissue is below opt. then allow for max. N assimilation otherwise utilize available N up to N opt.
          
          TODO:
            - is there any N uptake f P_growth <= 0?
            - how to partition available N between organs? If any is below a minimum serve this orgen first? 
        */

        /* calculate current tissue N conc. of live tissue [kg (N,protein) kg-1 (C, live tissue)]*/
        var f_N_live = {
          leaf: species.N_live_leaf() / species.C_live_leaf(),
          stem: species.N_live_stem() / species.C_live_stem(),
          root: species.N_root() / species.C_root()
        };

        var ordering = [
          { organ: ORGAN_LEAF, N: f_N_live.leaf / N_ref_opt },
          { organ: ORGAN_STEM, N: f_N_live.stem / (N_ref_opt * 0.5) }, 
          { organ: ORGAN_ROOT, N: f_N_live.root / (N_ref_opt * 0.5) } 
        ];

        /* sort in ascending order by N level */
        ordering.sort(function (a, b) {
          return a.N - b.N;
        });

        var N_up_pool = sum(mixture.N_up[s]);

        /* distribute available N uptake till depleted or N requirements met */
        for (var organ = 0; organ < 3; organ++) {
          
          var ρ = 0 // partitioning coefficent
            , f_sc = 0
            , f_pn = 0
            , N_ref_opt_organ = 0
            ; 

          if (ordering[organ].organ === ORGAN_LEAF) {

            ρ = ρ_shoot * ρ_l;
            f_sc = 0.50; // fix stucture fraction [kg (C,structure) kg-1 (C,tissue)]
            N_ref_opt_organ = N_ref_opt;
            f_pn = N_ref_max / fN_pn * fC_pn;
          
          } else if (ordering[organ].organ === ORGAN_STEM) {
            
            ρ = ρ_shoot * ρ_s;
            f_sc = 0.70; // fix stucture fraction [kg (C,structure) kg-1 (C,tissue)]
            N_ref_opt_organ = N_ref_opt * 0.5;
            f_pn = (N_ref_max * 0.5) / fN_pn * fC_pn;
          
          } else if (ordering[organ].organ === ORGAN_ROOT) {

            ρ = ρ_root;
            f_sc = 0.70; // fix stucture fraction [kg (C,structure) kg-1 (C,tissue)]
            N_ref_opt_organ = N_ref_opt * 0.5;
            f_pn = (N_ref_max * 0.5) / fN_pn * fC_pn;
          
          }

          if (DEBUG) {
            if (f_sc + f_pn > 1)
              throw new Error('f_sc + f_pn > 1');
          }

         /* calculate required N if tissue tries to assimilate up to max. N */
          var f_nc = 1 - (f_sc + f_pn)
            , Y = 1 / (1 + (1 - Y_sc) / Y_sc * f_sc + (1 - Y_nc) / Y_nc * f_nc + (1 - Y_pn) / Y_pn * f_pn)
            , C_assimilated = Y * P_growth * ρ /* [kg (C) m-2] */
            , N_assimilated = C_assimilated * f_pn * fN_pn / fC_pn /* [kg (N) m-2] */
            ;

          if (!isLegume && N_assimilated > N_up_pool)  {
            /* TODO: find a better implementation as such that a re-calculation of f_pn is not necessary.
              The idea here is that if N is limited the sc and nc fractions are increased (f_sc += 0.8 * (f_pn_old - f_pn)).
              It is unclear if this is a good representation of the underlying physiology but the result is satisfying in terms
              of typical observations in pastures during summer: high growth rates -> insufficient N uptake -> lower protein content -> 
              higher nc and ndf content.
              This has been implemented because it is not entirly clear in the SGS documentation what happens with the composition of 
              new tissue if nitrogen uptake is not sufficient to satisfy 'demand'.*/ 

            // recalculate C_assimilated with f_pn exactly depleting N_up_pool; sc is fixed
            // f_pn = (N(available) / (Y(f_sc,f_pn) * P)) * (fC_pn / fN_pn) -> solved for f_pn
            var f_pn_old = f_pn;
            f_pn = (
              (N_up_pool * (fC_pn / fN_pn) * Y_pn * (-f_sc * Y_sc + f_sc * Y_nc + Y_sc)) /
              (Y_sc * (N_up_pool * (fC_pn / fN_pn) * (Y_pn - Y_nc) + (P_growth * ρ) * Y_pn * Y_nc))
            );
            
            f_sc += 0.8 * (f_pn_old - f_pn);

            f_pn = (
              (N_up_pool * (fC_pn / fN_pn) * Y_pn * (-f_sc * Y_sc + f_sc * Y_nc + Y_sc)) /
              (Y_sc * (N_up_pool * (fC_pn / fN_pn) * (Y_pn - Y_nc) + (P_growth * ρ) * Y_pn * Y_nc))
            );

            f_nc = 1 - (f_sc + f_pn);

            if (DEBUG) {
              if (f_sc + f_pn > 1) {
                debug('f_sc', f_sc);
                debug('f_pn', f_pn);
                debug('f_nc', f_nc);
                throw new Error('x f_sc + f_pn > 1');
              }
            }

            Y = 1 / (1 + (1 - Y_sc) / Y_sc * f_sc + (1 - Y_nc) / Y_nc * f_nc + (1 - Y_pn) / Y_pn * f_pn);
            C_assimilated = Y * P_growth * ρ; /* [kg (C) m-2] */
            N_assimilated = C_assimilated * f_pn * fN_pn / fC_pn;

            if (DEBUG) {
              if (roundN(10, N_assimilated) != roundN(10, N_up_pool))
                throw new Error(N_assimilated != N_up_pool);
            }

            N_up_pool = 0;

          } else if (isLegume && N_assimilated > N_up_pool) {
            N_fix += N_assimilated - N_up_pool;
            N_up_pool = 0;
          } else {
            N_up_pool -= N_assimilated;
          }

          // only up to N_opt. No compensation if an organ (due to a low initial N conc.) consumes above N_opt
          N_req += (N_assimilated === 0) ? N_ref_opt_organ * C_assimilated : min(N_ref_opt_organ * C_assimilated, N_assimilated); 
          N_assim += N_assimilated;

          // update variables
          if (ordering[organ].organ === ORGAN_LEAF) {
            vars.Y_leaf = Y;
            vars.G_leaf = C_assimilated;
            // update composition of new growth to leaf
            vars.G_l_fC_om.sc = f_sc;
            vars.G_l_fC_om.nc = f_nc;
            vars.G_l_fC_om.pn = f_pn;
          } else if (ordering[organ].organ === ORGAN_STEM) {
            vars.Y_stem = Y;
            vars.G_stem = C_assimilated;
            // update composition of new growth to stem
            vars.G_s_fC_om.sc = f_sc;
            vars.G_s_fC_om.nc = f_nc;
            vars.G_s_fC_om.pn = f_pn;
          } else if (ordering[organ].organ === ORGAN_ROOT) {
            vars.Y_root = Y;
            vars.G_root = C_assimilated;
            // update composition of new growth to root
            vars.G_r_fC_om.sc = f_sc;
            vars.G_r_fC_om.nc = f_nc;
            vars.G_r_fC_om.pn = f_pn;
          }

        } // for each organ

        vars.Ω_N = pc_NitrogenResponseOn ? min(1, N_assim / N_req) : 1;
        vars.N_assim = N_assim;
        vars.N_req = N_req;
        vars.N_fix = N_fix;
        vars.G = vars.G_leaf + vars.G_stem + vars.G_root;

        /* additional protein synthesis (not growth) if N_up_pool still > 0 */
        vars.N_ass_add = 0;
        var fN_ass_add = 0.1;
        for (var organ = 0; organ < 3; organ++) {
        
          if (N_up_pool > 0) {
            
            if (ordering[organ].organ === ORGAN_LEAF && f_N_live.leaf < N_ref_opt) {

              var N_req_add = fN_ass_add * (N_ref_opt - f_N_live.leaf) * species.C_live_leaf();
              var N_ass_add = min(N_req_add, N_up_pool);
              var C_req_add = (N_ass_add / fN_pn * fC_pn) * 1 / Y_pn;
              if (C_req_add > vars.NC.l) { /* req. C for PN synthesis should not exceed avail. C from NC pool */ 
                N_ass_add = vars.NC.l * fN_pn * Y_pn / fC_pn;
                C_req_add = vars.NC.l;
              }
              vars.NC.l -= C_req_add;
              vars.PN.l += N_ass_add / fN_pn * fC_pn;
              N_up_pool -= N_ass_add;
              vars.N_assim += N_ass_add;
              vars.N_ass_add += N_ass_add;

            } else if (ordering[organ].organ === ORGAN_STEM && f_N_live.stem < N_ref_opt * 0.5) {

              var N_req_add = fN_ass_add * (N_ref_opt * 0.5 - f_N_live.stem) * species.C_live_stem();
              var N_ass_add = min(N_req_add, N_up_pool);
              var C_req_add = (N_ass_add / fN_pn * fC_pn) * 1 / Y_pn;
              if (C_req_add > vars.NC.s) {  /* req. C for PN synthesis should not exceed avail. C from NC pool */
                N_ass_add = vars.NC.s * fN_pn * Y_pn / fC_pn;
                C_req_add = vars.NC.s;
              }
              vars.NC.s -= C_req_add;
              vars.PN.s += N_ass_add / fN_pn * fC_pn;
              N_up_pool -= N_ass_add;
              vars.N_assim += N_ass_add;
              vars.N_ass_add += N_ass_add;
            
            } else if (ordering[organ].organ === ORGAN_ROOT && f_N_live.root < N_ref_opt * 0.5) {

              var N_req_add = fN_ass_add * (N_ref_opt * 0.5 - f_N_live.root) * species.C_root();
              var N_ass_add = min(N_req_add, N_up_pool);
              var C_req_add = (N_ass_add / fN_pn * fC_pn) * 1 / Y_pn;
              if (C_req_add > vars.NC.r) { /* req. C for PN synthesis should not exceed avail. C from NC pool */ 
                N_ass_add = vars.NC.r * fN_pn * Y_pn / fC_pn;
                C_req_add = vars.NC.r;
              }
              vars.NC.r -= C_req_add;
              vars.PN.r += N_ass_add / fN_pn * fC_pn;
              N_up_pool -= N_ass_add;
              vars.N_assim += N_ass_add;
              vars.N_ass_add += N_ass_add;
            
            }
          }
        }

      } else { // no growth: assimilates are not sufficent for respiratory costs 

        // TODO: e.g. (P_growth * NC.l / NC_p) > NC.l ? accelerate flux to dead?
        // TODO: what if nc pool is empty?


        if (!keepalive || species.DM_shoot() > DM_shoot_min) {

          var NC = vars.NC
            , NC_pool = NC.l + NC.s + NC.r
            ;

          /* reduce nc pools by share as long as non-structural pool > 0 */
          if (NC_pool > 0) {
            if (NC.l > 0)
              NC.l = max(0, NC.l + (P_growth * NC.l / NC_pool));
            if (NC.s > 0)
              NC.s = max(0, NC.s + (P_growth * NC.s / NC_pool));
            if (NC.r > 0)
              NC.r = max(0, NC.r + (P_growth * NC.r / NC_pool));
          }

          species.vars.Ω_N = 1;
          species.vars.N_assim = 0;
          species.vars.N_req = 0;
          vars.G = vars.G = vars.G_leaf = vars.G_stem = vars.G_root = 0;

        }

      }

    }


    /*
      (3.41 ff) Maintenance respiration

      R_m [kg (C) m-2 d-1]
    */
    
    function R_m(T, f_N, f_N_ref, W) {

      var R_m = 0
        , m_ref = cons.resp.m_ref
        ;
      
      R_m =  m_ref * f_m(T) * (f_N / f_N_ref) * W;

      return R_m;
      
    }


    /*
      (3.44) Maintenance temperature response
    */

    function f_m(T) {

      var f_m = 1
        , T_m_mn = cons.resp.T_m_mn
        , T_ref = cons.resp.T_ref
        ;

      f_m = (T <= T_m_mn) ? 0 : (T - T_m_mn) / (T_ref - T_m_mn);

      return f_m;

    }


    /*
      (3.51 ff) Respiratory costs of N uptake and fixation
    
      R_N     [kg (C) m-2 d-1]
      N_up    [kg (N) m-2]      daily N uptake
      N_fix   [kg (N) m-2]      daily N fixation
      
      λ_N_up  [kg (C) kg-1 (N)] N uptake respiration coefficent
      λ_N_fix [kg (C) kg-1 (N)] N fixation respiration coefficent

    */

    function R_N(N_up, N_fix) {

      var R_N = 0
        , λ_N_up = cons.resp.λ_N_up
        , λ_N_fix = cons.resp.λ_N_fix
        ;

      R_N = λ_N_up * N_up + λ_N_fix * N_fix;

      return R_N;

    }

  } // netPhotosynthesis
    

  /*
    Partitioning of net assimilates and tissue turnover

    G [kg (C) m-2 day-1]  net growth rate     
    
    TODO: 
      - include influence of defoliation (4.21c) 
      - trampling by animals (4.16m)
      - dead dAH
  */
  function partitioning(T) {

    /* iterate over mixture array */
    for (var s = 0, ps = mixture.length; s < ps; s++) {
  
      var species = mixture[s] 
        , vars = species.vars 
        , cons = species.cons 
        , G_r = vars.G_root
        , G_l = vars.G_leaf 
        , G_s = vars.G_stem
        ;

      /* growth dynamics */
      var SC = vars.SC
        , dSC = vars.dSC
        , NC = vars.NC
        , dNC = vars.dNC
        , PN = vars.PN
        , dPN = vars.dPN
        , AH = vars.AH
        , dAH = vars.dAH
        , Λ_r = vars.Λ_r
        , Λ_litter = vars.Λ_litter
          /* C fractions of new tissue already adjusted for nitrogen availability */
        , G_l_fC_om = vars.G_l_fC_om
        , G_s_fC_om = vars.G_s_fC_om
        , G_r_fC_om = vars.G_r_fC_om
          /* organic matter growth */
        , om_l = G_l * (G_l_fC_om.sc / fC_sc + G_l_fC_om.nc / fC_nc + G_l_fC_om.pn / fC_pn)
        , om_s = G_s * (G_s_fC_om.sc / fC_sc + G_s_fC_om.nc / fC_nc + G_s_fC_om.pn / fC_pn)
        , om_r = G_r * (G_r_fC_om.sc / fC_sc + G_r_fC_om.nc / fC_nc + G_r_fC_om.pn / fC_pn)
          /* leaf appearance rate */
        , Φ_l = 1 / 8
          /* leaf flux parameter */
        , l_live_per_tiller = 3
        , no_boxes = 3
        , γ_l = f_γ(T) * 0.05 // TODO: Φ_l * no_boxes / l_live_per_tiller
          /* stem flux parameter TODO: how to better relate γ_s, γ_r to γ_l */
        , γ_s = 0.8 * γ_l // 0.8 is scale factor turn over rate relative to leaves
        , γ_r = 0.02 * f_γ(T) // root senescense rate TODO: f_γ(T)?
          /* dead to litter flux adjusted for trampling (ref value from AgPasture) */
        , γ_dead = 0.11 + cons.part.γ_stock * ρ_stock
          /* no remob if N concentration already exceeds maximum */
        , fN_remob_l = (species.N_live_leaf() / species.C_live_leaf() < cons.N_leaf.max) ? 0.5 : 0
        , fN_remob_s = (species.N_live_stem() / species.C_live_stem() < cons.N_leaf.max * 0.5) ? 0.5 : 0
        , fN_remob_r = (species.N_root() / species.C_root() < cons.N_leaf.max * 0.5) ? 0.5 : 0
          /* fraction C remobilization in nc pool */
        , fC_remob = 0.8
        , live_2_dead_l = γ_l * SC.live_l_3 / (SC.live_l_1 + SC.live_l_2)
        , live_2_dead_s = γ_s * SC.live_s_3 / (SC.live_s_1 + SC.live_s_2)
        ;

      /* assimilated protein carbon to leaf, stem and root: new growth flux minus (flux to dead minus remobilization) 
          assume flux in pn and nc to dead is proportional to sc pool flux: live_2_dead_l */
      
      /* leaf */
      dPN.l = G_l * G_l_fC_om.pn - (PN.l * live_2_dead_l * (1 - fN_remob_l)); 
      dPN.dead_l = (PN.l * live_2_dead_l * (1 - fN_remob_l)) - (γ_dead * PN.dead_l);

      /* stem */
      dPN.s = G_s * G_s_fC_om.pn - (PN.s * live_2_dead_s * (1 - fN_remob_s));
      dPN.dead_s = (PN.s * live_2_dead_s * (1 - fN_remob_s)) - (γ_dead * PN.dead_s);
      
      /* root */
      dPN.r = G_r * G_r_fC_om.pn - (1 - fN_remob_r) * γ_r * PN.r;

      /* assimilated non-structural carbon to leaf, stem and root: new growth flux minus (flux to dead minus remobilization) */
      /* leaf */
      dNC.l = G_l * G_l_fC_om.nc - (NC.l * live_2_dead_l * (1 - fC_remob));
      dNC.dead_l = (NC.l * live_2_dead_l * (1 - fC_remob)) - (γ_dead * NC.dead_l);

      /* stem */
      dNC.s = G_s * G_s_fC_om.nc - (NC.s * live_2_dead_s * (1 - fC_remob));
      dNC.dead_s = (NC.s * live_2_dead_s * (1 - fC_remob)) - (γ_dead * NC.dead_s);

      /* root */
      dNC.r = G_r * G_r_fC_om.nc - (1 - fC_remob) * γ_r * NC.r;

      /* assimilated carbon to leaf converted to structural carbon minus flux of structure to age box n */
      /* (3.89 ff) leaf */
      dSC.live_l_1 = G_l * G_l_fC_om.sc - (2 * γ_l * SC.live_l_1);
      dSC.live_l_2 = (2 * γ_l * SC.live_l_1) - (γ_l * SC.live_l_2);
      dSC.live_l_3 = (γ_l * SC.live_l_2) - (γ_l * SC.live_l_3);
      dSC.dead_l = (γ_l * SC.live_l_3) - (γ_dead * SC.dead_l);

      /* stem */
      dSC.live_s_1 = G_s * G_s_fC_om.sc - (2 * γ_s * SC.live_s_1);
      dSC.live_s_2 = (2 * γ_s * SC.live_s_1) - (γ_s * SC.live_s_2);
      dSC.live_s_3 = (γ_s * SC.live_s_2) - (γ_s * SC.live_s_3);
      dSC.dead_s = (γ_s * SC.live_s_3) - (γ_dead * SC.dead_s);

      /* (3.97) root */
      dSC.r = G_r * G_r_fC_om.sc - (γ_r * SC.r);
      
      /* senescensed root input to litter */
      Λ_r.pn += (1 - fN_remob_r) * γ_r * PN.r;
      Λ_r.nc += (1 - fC_remob) * γ_r * NC.r;
      Λ_r.sc += γ_r * SC.r;

      /* (4.18m) input to litter. Johnson (2005/2008) */
      Λ_litter.sc += γ_dead * (SC.dead_l + SC.dead_s);
      Λ_litter.nc += γ_dead * (NC.dead_l + NC.dead_s);
      Λ_litter.pn += γ_dead * (PN.dead_l + PN.dead_s);

      /* track N re-mobilized */
      vars.N_remob = (
        fN_remob_l * (PN.l * live_2_dead_l) + 
        fN_remob_s * (PN.s * live_2_dead_s) + 
        fN_remob_r * γ_r * PN.r
      ) / fC_pn * fN_pn;

      /* ash */
      dAH.l = sqrt(vars.Ω_water) * cons.fAsh_dm_l_ref / (1 - cons.fAsh_dm_l_ref) * om_l;
      dAH.s = sqrt(vars.Ω_water) * cons.fAsh_dm_s_ref / (1 - cons.fAsh_dm_s_ref) * om_s;
      dAH.r = sqrt(vars.Ω_water) * cons.fAsh_dm_r_ref / (1 - cons.fAsh_dm_r_ref) * om_r;

      AH.l += dAH.l - γ_dead * AH.l * SC.dead_l / (SC.live_l_1 + SC.live_l_2 + SC.live_l_3);
      AH.s += dAH.s - γ_dead * AH.s * SC.dead_s / (SC.live_s_1 + SC.live_s_2 + SC.live_s_3);
      AH.r += dAH.r - γ_r * AH.r;

      /* update C pools with dSC, dPN, dNC */

      /* leaf */
      SC.live_l_1 += dSC.live_l_1;
      SC.live_l_2 += dSC.live_l_2;
      SC.live_l_3 += dSC.live_l_3;
      SC.dead_l += dSC.dead_l;
      
      NC.l += dNC.l;
      NC.dead_l += dNC.dead_l;

      PN.l += dPN.l;
      PN.dead_l += dPN.dead_l;

      /* sheath and stem */
      SC.live_s_1 += dSC.live_s_1;
      SC.live_s_2 += dSC.live_s_2;
      SC.live_s_3 += dSC.live_s_3;
      SC.dead_s += dSC.dead_s;
      
      NC.s += dNC.s;
      NC.dead_s += dNC.dead_s;

      PN.s += dPN.s;
      PN.dead_s += dPN.dead_s;

      /* root */
      SC.r += dSC.r;
      NC.r += dNC.r;
      PN.r += dPN.r;

      /* cost of tissue aging e.g. lignin synthesis TODO: calculate cost of ndf synthesis, increase ndf share? */
      // NC.l = max(0, NC.l - 0.05 * (2 * γ_l * SC.live_l_1));
      // NC.s = max(0, NC.s - 0.05 * (2 * γ_s * SC.live_s_1));
      // NC.r = max(0, NC.r - 0.05 * (γ_r * SC.r));

    }

    /*
      (3.99) Influence of temperature on growth dynamics

      f_γ [0-1]
      T   [°C]
      
      TODO: parameters? Default for rye grass (3.100)
    */

    function f_γ(T) {

      var f_γ = 0
        , T_mn = 3
        , T_opt = 20
        , T_ref = 20
        , q = 2
        ;

      /* (1.40) constrain */
      if (T_ref > T_opt)
        T_ref = T_opt;

      if (T <= T_mn)
        f_γ = 0;
      else if (T_mn < T < T_opt)
        f_γ = pow((T - T_mn) / (T_ref - T_mn), q) * (((1 + q) * T_opt - T_mn - q * T) / ((1 + q) * T_opt - T_mn - q * T_ref));
      else if (T >= T_opt)
        f_γ = pow((T_opt - T_mn) / (T_ref - T_mn), q) * ((T_opt - T_mn) / ((1 + q) * T_opt - T_mn - q * T_ref));

      return f_γ;

    }
    
  }


  function phenology() {

    for (var s = 0; s < numberOfSpecies; s++) {

      var part = mixture[s].cons.part;
      var vars = mixture[s].vars;
      
      if (mixture.isRegrowth)
        vars.ρ_l = max(0.2, (1 - part.ρ_l_max) + (2 * part.ρ_l_max - 1) * 1 / (1 + exp(10 * ((vars.GDD / (3 * part.GDD_flower)) - 0.5))));
      else
        vars.ρ_l = max(0.2, (1 - part.ρ_l_max) + (2 * part.ρ_l_max - 1) * 1 / (1 + exp(10 * ((vars.GDD / (2 * part.GDD_flower)) - 0.5))));
    
    }

  } // phenology

  function resetPhenology(s) {

    if (s === undefined) {

      for (var s = 0; s < numberOfSpecies; s++) {
        var vars = mixture[s].vars;
        vars.ρ_l = mixture[s].cons.part.ρ_l_max;
        vars.GDD = 0;
      }

    } else {

      mixture[s].vars.ρ_l = mixture[s].cons.part.ρ_l_max;
      mixture[s].vars.GDD = 0;      
    
    }

  }


  /*
    doy         [#]             doy
    T           [C°]            mean daily temperature
    T_mx        [C°]            maximum daily temperature
    T_mn        [C°]            minimum daily temperature
    R_s         [MJ m-2]        global radiation
    sunhours    [h]             unused
    rh          [-]             relative humidity
    u           [m-s]           wind speed
    u_h         [m]             wind speed height
    C_amb       [μmol mol-1]    CO2 concentration
    rr          [mm]            rainfall
    f_s         [-]             fraction direct solar radiation
    τ           [s]             daylength
    R_a         [MJ m-2]        extraterrestrial radiation
    isVegPeriod [bool]
  */

  var step = function (doy, T, T_mx, T_mn, R_s, sunhours, rh, u, u_h, C_amb, rr, f_s, τ, R_a, isVegPeriod) {

    var PPF = R_s * PPF_PER_MJ_GLOBAL_RADIATION;

    /* set root distribution variables */
    rootDistribution();
    /* set max. potential nitrogen uptake */
    nitrogenUptake();

    // groundwater
    // var vc_RootingZone = toInt(floor(0.5 + ((1.3 * mixture.d_r_mx()) / vs_LayerThickness)));
    // var vm_GroundwaterTable = toInt(soilColumn.vm_GroundwaterTable);

    /* TODO: set for each species? */ 
    vc_ReferenceEvapotranspiration =  fc_ReferenceEvapotranspiration(T, T_mx, T_mn, rh, u, u_h, R_s, C_amb, R_a);

    interception(rr);

    // from fc_CropWaterUptake -->
    vc_PotentialEvapotranspiration = min(6.5, vc_ReferenceEvapotranspiration * vc_KcFactor); // [mm]

    vc_RemainingEvapotranspiration = vc_PotentialEvapotranspiration; // [mm]

    // If crop holds intercepted water, first evaporation from crop surface
    if (vc_InterceptionStorage > 0.0) {
      if (vc_RemainingEvapotranspiration >= vc_InterceptionStorage) {
        vc_RemainingEvapotranspiration -= vc_InterceptionStorage;
        vc_EvaporatedFromIntercept = vc_InterceptionStorage;
        vc_InterceptionStorage = 0.0;
      } else {
        vc_InterceptionStorage -= vc_RemainingEvapotranspiration;
        vc_EvaporatedFromIntercept = vc_RemainingEvapotranspiration;
        vc_RemainingEvapotranspiration = 0.0;
      }
    } else {
      vc_EvaporatedFromIntercept = 0.0;
    } // <-- from MONICA cropGrowth.fc_CropWaterUptake

    var E_T_pot = vc_RemainingEvapotranspiration;

    /* set actual transpiration and water limiting factor */
    transpiration(E_T_pot);
    
    /* set high and low temperature limiting factors */
    highAndLowTempStress(T, T_mn, T_mx);

    /* set species.vars.P_g_day */
    grossPhotosynthesis(T, T_mn, T_mx, PPF, τ, C_amb, f_s);

    netPhotosynthesis(T);

    for (var s = 0; s < numberOfSpecies; s++) {

      var vars = mixture[s].vars;
      var N_up_pot = sum(mixture.N_up[s]);
      vars.N_up = vars.N_assim; // TODO vars.N_assim - Fixation
      for (var l = 0; l < vs_NumberOfLayers; l++)
        mixture.N_up[s][l] = vars.N_up * mixture.N_up[s][l] / N_up_pot;


      // GDD, fixed base temp. at 5
      if (!isVegPeriod) {
        vars.GDD = 0;
        mixture.isRegrowth = false;
      } else {  
        if (mixture[s].vars.ρ_l <= 0.35)  //TODO: end of growth cycle? 
          resetPhenology(s);

        vars.GDD += max(0, T - 5);
      }

    }
    
    partitioning(T);

    phenology();

  }; // step end


  /* 
    set and update variables:
    mixture.f_r root  fration per species and soil layer
    f_r_sum   root fraction sum per species
    W_r       root kg DM m-2 per species and soil layer
    W_r_sum   root kg DM m-2 sum per soil layer
  */
  function rootDistribution() {

    /* root distribution scaling factor */
    var q_r = 3;

    for (var s = 0; s < numberOfSpecies; s++) {

      var species = mixture[s];
      /* TODO: move k_sum calc. somewhere else */
      species.vars.τ++;
      species.vars.k_sum = min(1, species.vars.τ / species.cons.τ_veg);
      var DM_root = species.DM_root();
      /* Johnson 2008, eq. 4.19b */ 
      species.vars.d_r = 0.05 + (species.cons.d_r_mx - 0.05) * species.vars.k_sum;

      mixture.f_r_sum[s] = 0;

      for (var l = 0; l < vs_NumberOfLayers; l++) {
        /* z [m] upper boundary of layer l */
        var z = vs_LayerThickness * l;
        if (z > species.vars.d_r) {
          /* since mixture.f_r only approaches zero (asymptote, f_r_sum < 1) we stop at root depth d_r and later relate f_r_l to f_r_sum */
          mixture.f_r[s][l] = 0;
          continue;
        }
        /* (4.19c) Johnson (2008) relative root distribution share in layer l. upper minus lower layer boundary */
        mixture.f_r[s][l] = (
          (1 / (1 + pow((z / species.cons.d_r_h) * (species.cons.d_r_mx / species.vars.d_r), q_r))) - 
          (1 / (1 + pow(((z + vs_LayerThickness) / species.cons.d_r_h) * (species.cons.d_r_mx / species.vars.d_r), q_r)))
        );
        mixture.f_r_sum[s] += mixture.f_r[s][l];
      }

      /* distribute root DM to each soil layer */
      for (var l = 0; l < vs_NumberOfLayers; l++)
        mixture.W_r[s][l] = DM_root * mixture.f_r[s][l] / mixture.f_r_sum[s];
        
    } // for each species

    for (var l = 0; l < vs_NumberOfLayers; l++) {
      mixture.W_r_sum[l] = 0; 
      for (var s = 0; s < numberOfSpecies; s++) {
        mixture.W_r_sum[l] += mixture.W_r[s][l]; /* total root mass per layer */
      }
    }

    // var DM_root = mixture.DM_root() /* [kg (d.wt) m-2] */
    //   , C_root = mixture.C_root()      [kg (C) m-2] 
    //   , pc_SpecificRootLength = 300   /* [m kg-1 (d.wt)] is identical for all crops in MONICA db */
    //   ;

    /* set root density: workaround to use MONICAS water uptake routines */
    // for (var l = 0; l < vs_NumberOfLayers; l++)
    //   vc_RootDensity[l] = (1 / vs_LayerThickness) * pc_SpecificRootLength * W_r_sum[l] * DM_root / C_root;

  };


  /* 
    set and update variables:
    N_up      potential N uptake kg N m-2 per species and soil layer
    N_up_sum  potential N uptake kg N m-2 per soil layer

    NH4 uptake disabled
  */
  function nitrogenUptake() {

    var d_r_mx = mixture.d_r_mx() // max. root depth [m]
      , bulkDensity = 0
      , soilNX = 0
      , layer = null
      , ξ_N = 0
      , N_up_sum = 0
      , N_up = 0
      ;

    // var dwt2carbon = 1 / 0.45; // TODO: calculate real conversion per species

    // for (var l = 0; l < vs_NumberOfLayers; l++) {
    //   var layer = soilColumn[l];
    //   /* kg (N) m-3 / kg (soil) m-3 = kg (N) kg-1 (soil) */
    //   var N = (layer.get_SoilNO3() /*+ layer.get_SoilNH4()*/) / layer.vs_SoilBulkDensity();
    //   /* Johnson 2013, eq. 3.69 [kg (soil) kg-1 (root C)] TODO: error in doc. ? suppose it is per kg (root C) instead per kg (root d.wt) */
    //   var ξ_N = 200; //* dwt2carbon; // convert from dwt to carbon TODO: value? unit? allow per species
    //   /* total uptake from layer must not exceed layer N */
    //   mixture.N_up_sum[l] = min((layer.get_SoilNO3() /*+ layer.get_SoilNH4()*/) * vs_LayerThickness, ξ_N * N * mixture.W_r_sum[l]);
    // }

    // for (var l = 0; l < vs_NumberOfLayers; l++) {
    //   for (var s = 0; s < numberOfSpecies; s++)
    //     mixture.N_up[s][l] = (mixture.W_r_sum[l] === 0) ? 0 : mixture.N_up_sum[l] * mixture.W_r[s][l] / mixture.W_r_sum[l];
    // }

    for (var l = 0; l < vs_NumberOfLayers; l++) {

      layer = soilColumn[l];
      bulkDensity = layer.vs_SoilBulkDensity();
      soilNX = layer.get_SoilNO3(); /*+ layer.get_SoilNH4()*/
      N_up_sum = 0;

      for (var s = 0; s < numberOfSpecies; s++) {

        ξ_N = mixture[s].cons.ξ_N;

        if ((ξ_N * soilNX / bulkDensity * mixture.W_r[s][l] + N_up_sum) > (soilNX * vs_LayerThickness))
          N_up = (soilNX * vs_LayerThickness) - N_up_sum;
        else
          N_up = ξ_N * soilNX / bulkDensity * mixture.W_r[s][l];

        mixture.N_up[s][l] = N_up;
        N_up_sum += N_up;

      }
      
      mixture.N_up_sum[l] = N_up_sum;
    }
    

  } // nitrogenUptake

  
  function fc_ReferenceEvapotranspiration(vw_MeanAirTemperature, vw_MaxAirTemperature, vw_MinAirTemperature, vw_RelativeHumidity, vw_WindSpeed, vw_WindSpeedHeight, vc_GlobalRadiation, vw_AtmosphericCO2Concentration, vc_ExtraterrestrialRadiation) {

    var vc_AtmosphericPressure; //[kPA]
    var vc_PsycrometerConstant; //[kPA °C-1]
    var vc_SaturatedVapourPressureMax; //[kPA]
    var vc_SaturatedVapourPressureMin; //[kPA]
    var vc_SaturatedVapourPressure; //[kPA]
    var vc_VapourPressure; //[kPA]
    var vc_SaturationDeficit; //[kPA]
    var vc_SaturatedVapourPressureSlope; //[kPA °C-1]
    var vc_WindSpeed_2m; //[m s-1]
    var vc_AerodynamicResistance; //[s m-1]
    var vc_SurfaceResistance; //[s m-1]
    var vc_ReferenceEvapotranspiration; //[mm]
    var vw_NetRadiation; //[MJ m-2]

    var user_crops = centralParameterProvider.userCropParameters;
    var pc_SaturationBeta = user_crops.pc_SaturationBeta; // Original: Yu et al. 2001; beta = 3.5
    var pc_StomataConductanceAlpha = user_crops.pc_StomataConductanceAlpha; // Original: Yu et al. 2001; alpha = 0.06
    var pc_ReferenceAlbedo = user_crops.pc_ReferenceAlbedo; // FAO Green gras reference albedo from Allen et al. (1998)

    // Calculation of atmospheric pressure
    vc_AtmosphericPressure = 101.3 * pow(((293.0 - (0.0065 * vs_HeightNN)) / 293.0), 5.26);

    // Calculation of psychrometer constant - Luchtfeuchtigkeit
    vc_PsycrometerConstant = 0.000665 * vc_AtmosphericPressure;

    // Calc. of saturated water vapour pressure at daily max temperature
    vc_SaturatedVapourPressureMax = 0.6108 * exp((17.27 * vw_MaxAirTemperature) / (237.3 + vw_MaxAirTemperature));

    // Calc. of saturated water vapour pressure at daily min temperature
    vc_SaturatedVapourPressureMin = 0.6108 * exp((17.27 * vw_MinAirTemperature) / (237.3 + vw_MinAirTemperature));

    // Calculation of the saturated water vapour pressure
    vc_SaturatedVapourPressure = (vc_SaturatedVapourPressureMax + vc_SaturatedVapourPressureMin) / 2.0;

    // Calculation of the water vapour pressure
    if (vw_RelativeHumidity <= 0.0){
      // Assuming Tdew = Tmin as suggested in FAO56 Allen et al. 1998
      vc_VapourPressure = vc_SaturatedVapourPressureMin;
    } else {
      vc_VapourPressure = vw_RelativeHumidity * vc_SaturatedVapourPressure;
    }

    // Calculation of the air saturation deficit
    vc_SaturationDeficit = vc_SaturatedVapourPressure - vc_VapourPressure;

    // Slope of saturation water vapour pressure-to-temperature relation
    vc_SaturatedVapourPressureSlope = (4098.0 * (0.6108 * exp((17.27 * vw_MeanAirTemperature) / (vw_MeanAirTemperature
        + 237.3)))) / ((vw_MeanAirTemperature + 237.3) * (vw_MeanAirTemperature + 237.3));

    // Calculation of wind speed in 2m height
    vc_WindSpeed_2m = vw_WindSpeed * (4.87 / (log(67.8 * vw_WindSpeedHeight - 5.42)));

    // Calculation of the aerodynamic resistance
    vc_AerodynamicResistance = 208.0 / vc_WindSpeed_2m;

    // if (vc_GrossPhotosynthesisReference_mol <= 0.0) {
    //   vc_StomataResistance = 999999.9; // [s m-1]
    // } else {
    //   vc_StomataResistance = // [s m-1]
    //       (vw_AtmosphericCO2Concentration * (1.0 + vc_SaturationDeficit / pc_SaturationBeta))
    //           / (pc_StomataConductanceAlpha * vc_GrossPhotosynthesisReference_mol);
    // }

    // johnson default canopy conductance g_c = 0.015 [m s-1] inverse of stomata resistance
    vc_StomataResistance = 1 / 0.015;  

    vc_SurfaceResistance = vc_StomataResistance / 1.44;

    // vc_SurfaceResistance = vc_StomataResistance / (vc_CropHeight * vc_LeafAreaIndex);

    // vw_NetRadiation = vc_GlobalRadiation * (1.0 - pc_ReferenceAlbedo); // [MJ m-2]

    var vc_ClearSkyShortwaveRadiation = (0.75 + 0.00002 * vs_HeightNN) * vc_ExtraterrestrialRadiation;
    var vc_RelativeShortwaveRadiation = vc_GlobalRadiation / vc_ClearSkyShortwaveRadiation;
    var vc_NetShortwaveRadiation = (1.0 - pc_ReferenceAlbedo) * vc_GlobalRadiation;

    var pc_BolzmanConstant = 0.0000000049; // Bolzmann constant 4.903 * 10-9 MJ m-2 K-4 d-1
    vw_NetRadiation = vc_NetShortwaveRadiation - (pc_BolzmanConstant
      * (pow((vw_MinAirTemperature + 273.16), 4.0) + pow((vw_MaxAirTemperature
      + 273.16), 4.0)) / 2.0 * (1.35 * vc_RelativeShortwaveRadiation - 0.35)
      * (0.34 - 0.14 * sqrt(vc_VapourPressure)));

    // Calculation of reference evapotranspiration
    // Penman-Monteith-Method FAO
    vc_ReferenceEvapotranspiration = ((0.408 * vc_SaturatedVapourPressureSlope * vw_NetRadiation)
        + (vc_PsycrometerConstant * (900.0 / (vw_MeanAirTemperature + 273.0)) * vc_WindSpeed_2m * vc_SaturationDeficit))
        / (vc_SaturatedVapourPressureSlope + vc_PsycrometerConstant * (1.0 + (vc_SurfaceResistance / vc_AerodynamicResistance)));

    return vc_ReferenceEvapotranspiration;

  } // fc_ReferenceEvapotranspiration

  // set vc_NetPrecipitation & vc_InterceptionStorage
  function interception(vw_GrossPrecipitation) {

    var vc_InterceptionStorageOld = vc_InterceptionStorage;

    // Interception in [mm d-1];
    var vc_Interception = max(0, (2.5 * mixture.h_mx() * mixture.f_g) - vc_InterceptionStorage);

    // If no precipitation occurs, vm_Interception = 0
    if (vw_GrossPrecipitation <= 0) {
      vc_Interception = 0.0;
    }

    // Calculating net precipitation and adding to surface water
    if (vw_GrossPrecipitation <= vc_Interception) {
      vc_Interception = vw_GrossPrecipitation;
      vc_NetPrecipitation = 0.0;
    } else {
      vc_NetPrecipitation = vw_GrossPrecipitation - vc_Interception;
    }

    // add intercepted precipitation to the virtual interception water storage
    vc_InterceptionStorage = vc_InterceptionStorageOld + vc_Interception;

  } // interception


  /* 
    set 
      - E_T per species and layer
      - Ω_water per species
      - f_g

    TODO: groundwater?
  */
  function transpiration(E_T_pot) {

    var E_T_demand = []
      , E_T_demand_remaining = []
      , L_tot = mixture.L_tot()
      , θ_w = []
      , θ_fc = []
      , θ_r = []
      , θ_sat = []
      , θ = []
      , g_water = []
      ;

    /* fractional ground cover. Johnson 2013, eq. 2.23, TODO: weighted k (0.5)? */
    mixture.f_g = 1 - exp(-0.5 * L_tot);
    /* adjust for ground cover */
    E_T_pot = mixture.f_g * E_T_pot;
    vc_PotentialTranspiration = E_T_pot;

    /* distribute E_T_pot to each species */
    for (var s = 0; s < numberOfSpecies; s++) {
      E_T_demand[s] = E_T_pot * mixture[s].L() / L_tot;
      E_T_demand_remaining[s] = E_T_demand[s];

      /* reset actual transpiration */
      for (var l = 0; l < vs_NumberOfLayers; l++)
        mixture.E_T[s][l] = 0;
    }
 
    for (var l = 0; l < vs_NumberOfLayers; l++) {
      /* [m3 m-3] to [mm m-2] */
      θ_w[l] = soilColumn[l].get_PermanentWiltingPoint() * 1e3 * vs_LayerThickness;
      θ_fc[l] = soilColumn[l].get_FieldCapacity() * 1e3 * vs_LayerThickness;
      θ_r[l] = θ_fc[l] * 0.8;
      θ_sat[l] = soilColumn[l].get_Saturation() * 1e3 * vs_LayerThickness;
      θ[l] = soilColumn[l].get_Vs_SoilMoisture_m3() * 1e3 * vs_LayerThickness;
      if (θ[l] < θ_w[l])
        g_water[l] = 0;
      else if (θ[l] < θ_r[l])
        g_water[l] = (θ[l] - θ_w[l]) / (θ_r[l] - θ_w[l]);
      else if (θ[l] < θ_fc[l])
        g_water[l] = 1;
      else /* water logging */
        g_water[l] = 1 - 0.5 * (θ[l] - θ_fc[l]) / (θ_sat[l] - θ_fc[l]);
    }

    /* sort in ascending order by Ω_water to avoid that stress occurs due to order */
    mixture.sort(function (a, b) {
      return a.vars.Ω_water - b.vars.Ω_water;
    });

    var index = 0; /* original index prior sorting */

    for (var i = 0; i < 5; i++) { // run x times to compensate for dry layers
      for (var l = 0; l < vs_NumberOfLayers; l++) {
        for (var s = 0; s < numberOfSpecies; s++) {

          index = mixture[s].cons.index;

          if (E_T_demand_remaining[index] <= 0 || mixture.f_r[index][l] === 0 || θ[l] <= θ_w[l])
            continue;

          /* Johnson 2013/2008, eq. 3.2. */
          var add = min(θ[l] - θ_w[l], (mixture.f_r[index][l] / mixture.f_r_sum[index]) * g_water[l] * E_T_demand_remaining[index]);
          mixture.E_T[index][l] += add;
          θ[l] -= add; /* update soil water */
          E_T_demand_remaining[index] -= add; /* keep track of remaining E_T demand */

          if (DEBUG) {
            if (θ[l] < 0 || θ[l] > θ_sat[l])
              throw new Error('θ < 0 || θ > θ_sat');
          }

        }
      }
    }

    /* restore order */
    mixture.sort(function (a, b) {
      return a.cons.index - b.cons.index;
    });

    /* set water growth limiting factor */
    if (waterDeficitResponseOn) {
      for (var s = 0; s < numberOfSpecies; s++) {
        /* update sum */
        mixture.E_T_sum[s] = sum(mixture.E_T[s]);
        if (mixture.E_T_sum[s] === 0)
           mixture[s].vars.Ω_water = 1; /* avoid 0 / 0 = NaN */
        else
          mixture[s].vars.Ω_water = min(1, mixture.E_T_sum[s] / E_T_demand[s]);
      }
    } else {
      for (var s = 0; s < numberOfSpecies; s++)
        mixture[s].vars.Ω_water = 1;
    }

  } // transpiration


  /* API (public) functions */

  /* [kg (DM) ha-1] */
  var growthIncrement = function (organIdx, speciesIdx) {
    
    var increment = 0;
    if (organIdx === undefined && speciesIdx === undefined) {
      increment = mixture.dDM_shoot() + mixture.dDM_root();
    } else if (organIdx !== undefined && speciesIdx !== undefined) {
      if (organIdx === ORGAN_ROOT)
        increment = mixture[speciesIdx].dDM_root();
      else if (organIdx === ORGAN_LEAF)
        increment = mixture[speciesIdx].dDM_leaf();
      else if (organIdx === ORGAN_STEM)
        increment = mixture[speciesIdx].dDM_stem();
      else
        increment = 0;
    } else {
      if (organIdx === undefined) {
        var species = mixture[speciesIdx];
        increment = species.dDM_leaf() + species.dDM_stem() + species.dDM_root();
      } else {
        if (organIdx === ORGAN_ROOT)
          increment = mixture.dDM_root();
        else if (organIdx === ORGAN_LEAF)
          increment = mixture.dDM_leaf();
        else if (organIdx === ORGAN_STEM)
          increment = mixture.dDM_stem();
        else
          increment = 0;
      }
    }

    return increment * SQM_PER_HA;

  };

  var transpired = function (layerIdx, speciesIdx) {

    var transpired = 0, i = 0, j = 0;
    
    if (layerIdx === undefined && speciesIdx === undefined) {
      for (i = 0; i < numberOfSpecies; i++) {
        for (j = 0; j < vs_NumberOfLayers; j++)
          transpired += mixture.E_T[i][j];
      }      
    } else if (layerIdx !== undefined && speciesIdx !== undefined) {
      transpired = mixture.E_T[speciesIdx][layerIdx];
    } else {
      if (layerIdx === undefined) {
        for (i = 0; i < vs_NumberOfLayers; i++)
          transpired += mixture.E_T[speciesIdx][i];
      } else { // TODO: move up. This is (probably) in most cases true
        for (i = 0; i < numberOfSpecies; i++)
          transpired += mixture.E_T[i][layerIdx];
      }
    }

    return transpired;
  
  };

  /* [kg (DM) ha-1] */
  var shootBiomass = function (speciesIdx) {

    var mass = 0;
    if (speciesIdx === undefined) {
      mass = mixture.DM_shoot();
    } else {
      var species = mixture[speciesIdx];
      mass = species.DM_shoot();
    }

    return mass * SQM_PER_HA;

  };

  /* 
    [kg (DM) ha-1]
    height [m]
  */
  var shootBiomassByHeight = function (height) {

    if (height <= 0)
      return shootBiomass();

    var mix_h = mixture.h();
    var dm = 0;

    if (height <= mix_h)
      dm = mixture.DM_shoot() * height / mix_h;

    return dm * SQM_PER_HA;

  };

  /*
    OMD [kg kg-1] 
    TODO: by height, fix OM vs DM 
  */
  var shootOrganicMatterDigestibility = function () {

    if (numberOfSpecies === 1)
      return mixture[0].OMD_shoot();

    var DOM = 0;

    for (var s = 0; s < numberOfSpecies; s++) {

      var species = mixture[s];

      DOM += species.OM_shoot() * species.OMD_shoot();

    }

    return DOM / (shootBiomass() / SQM_PER_HA);

  };

  /*
    OM [g kg-1 (DM)] 
    TODO: by height, fix OM vs DM 
  */
  var shootOrganicMatterContent = function () {

    if (numberOfSpecies === 1)
      return mixture[0].OM_shoot() / mixture[0].DM_shoot() * 1e3; // kg to g

    var OM = 0;

    for (var s = 0; s < numberOfSpecies; s++) {

      var species = mixture[s];

      OM += species.OM_shoot() * 1e3; // kg to g

    }

    return OM / (shootBiomass() / SQM_PER_HA);

  };

  /*
    CP [g kg-1 (DM)] 
    TODO: by height
  */
  var shootCrudeProteinContent = function () {

    if (numberOfSpecies === 1)
      return mixture[0].CP_shoot();

    var CP = 0;

    for (var s = 0; s < numberOfSpecies; s++) {

      var species = mixture[s];

      CP += species.DM_shoot() * species.CP_shoot();

    }

    return CP / (shootBiomass() / SQM_PER_HA);

  };

  /*
    CF [g kg-1 (DM)] 
    TODO: by height
  */
  var shootCrudeFibreContent = function () {

    if (numberOfSpecies === 1)
      return mixture[0].CF_shoot();

    var CF = 0;

    for (var s = 0; s < numberOfSpecies; s++) {

      var species = mixture[s];

      CF += species.DM_shoot() * species.CF_shoot();

    }

    return CF / (shootBiomass() / SQM_PER_HA);

  };

  /* 
    [kg (DM) ha-1]
    height [m]

    TODO: add parameter to set nutritive contents
  */
  var harvestShootBiomassByHeight = function (height) {

    var mix_h = mixture.h();
    if (height < 0 || height > mix_h)
      return 0;

    var DM = 0;
    var f_keep = 1;

    for (var s = 0; s < numberOfSpecies; s++) {

      var species = mixture[s]
        , vars = species.vars
        , DM_shoot = species.DM_shoot()
        , SC = vars.SC
        , NC = vars.NC
        , PN = vars.PN
        , AH = vars.AH
        ;

      if (DM_shoot <= DM_shoot_min)
        f_keep = 1;
      else if (height / mix_h * DM_shoot <= DM_shoot_min)
        f_keep = DM_shoot_min / DM_shoot;
      else
        f_keep = height / mix_h;

      DM += (1 - f_keep) * DM_shoot;

      // update pools
      SC.live_l_1 *= f_keep;
      SC.live_l_2 *= f_keep; 
      SC.live_l_3 *= f_keep; 
      SC.dead_l   *= f_keep;   
      SC.live_s_1 *= f_keep; 
      SC.live_s_2 *= f_keep; 
      SC.live_s_3 *= f_keep; 
      SC.dead_s   *= f_keep;

      NC.l      *= f_keep;
      NC.dead_l *= f_keep;
      NC.s      *= f_keep;
      NC.dead_s *= f_keep;
      PN.l      *= f_keep;
      PN.dead_l *= f_keep;
      PN.s      *= f_keep;
      PN.dead_s *= f_keep;
      AH.l      *= f_keep;
      AH.dead_l *= f_keep;
      AH.s      *= f_keep;
      AH.dead_s *= f_keep;

      // start new growth cycle
      species.vars.GDD = 0;
    
    }

    mixture.isRegrowth = true;
    resetPhenology();

    return DM * SQM_PER_HA;

  };

  /* 
    [kg (DM) ha-1]
    [kg (DM) ha-1]
  */
  var harvestShootBiomass = function (dryMatter) {

    var DM = 0;
    if (dryMatter <= 0)
      return DM;
 
    var f_keep = 1 - min(1, dryMatter / (mixture.DM_shoot() * SQM_PER_HA));

    for (s = 0; s < numberOfSpecies; s++) {

      var species = mixture[s];

      var vars = species.vars
        , DM_shoot = species.DM_shoot()
        , SC = vars.SC
        , NC = vars.NC
        , PN = vars.PN
        , AH = vars.AH
        ;

      // if (DM_shoot <= DM_shoot_min)
      //   f_keep = 1;
      // else if (f_keep * DM_shoot <= DM_shoot_min)
      //   f_keep = DM_shoot_min / DM_shoot;

      DM += (1 - f_keep) * DM_shoot;

      // update pools
      SC.live_l_1 *= f_keep;
      SC.live_l_2 *= f_keep; 
      SC.live_l_3 *= f_keep; 
      SC.dead_l   *= f_keep;   
      SC.live_s_1 *= f_keep; 
      SC.live_s_2 *= f_keep; 
      SC.live_s_3 *= f_keep; 
      SC.dead_s   *= f_keep;

      NC.l      *= f_keep;
      NC.dead_l *= f_keep;
      NC.s      *= f_keep;
      NC.dead_s *= f_keep;
      PN.l      *= f_keep;
      PN.dead_l *= f_keep;
      PN.s      *= f_keep;
      PN.dead_s *= f_keep;
      AH.l      *= f_keep;
      AH.dead_l *= f_keep;
      AH.s      *= f_keep;
      AH.dead_s *= f_keep;

      // start new growth cycle
      mixture[s].vars.GDD = 0;
    }

    mixture.isRegrowth = true;
    resetPhenology();

    return DM * SQM_PER_HA;

  };


  /* [kg (DM) ha-1] */
  var rootBiomass = function (speciesIdx) {

    return (speciesIdx === undefined ? mixture.DM_root() : mixture[speciesIdx].DM_root()) * SQM_PER_HA;
  
  };


  var referenceEvapotranspiration = function () {

    return vc_ReferenceEvapotranspiration;

  };


  var remainingEvapotranspiration = function () {

    return vc_RemainingEvapotranspiration;

  };


  var evaporatedFromIntercept = function () {

    return vc_EvaporatedFromIntercept; 

  };


  var netPrecipitation = function () {

    return vc_NetPrecipitation;

  };


  var rootingDepth = function (speciesIdx) {

    return (speciesIdx === undefined ? mixture.d_r_mx() : mixture[speciesIdx].vars.d_r);

  };


  var soilCoverage = function (speciesIdx) {

    return (speciesIdx === undefined ? mixture.f_g : (1 - exp(-0.5 * mixture[speciesIdx].L())));

  };


  var stomataResistance = function (/*speciesIdx*/) {

    return vc_StomataResistance;

  };


  var potentialTranspiration = function (/*speciesIdx*/) {

    return vc_PotentialTranspiration;

  };


  /* [kg (N) m-2] */
  var actualNitrogenUptake = function (layerIdx, speciesIdx) {

    var uptake = 0, i = 0, j = 0;

    if (layerIdx === undefined && speciesIdx === undefined) {
      for (i = 0; i < numberOfSpecies; i++) {
        for (j = 0; j < vs_NumberOfLayers; j++)
          uptake += mixture.N_up[i][j];
      }      
    } else if (layerIdx !== undefined && speciesIdx !== undefined) {
      uptake = mixture.N_up[speciesIdx][layerIdx];
    } else {
      if (layerIdx === undefined) {
        for (i = 0; i < vs_NumberOfLayers; i++)
          uptake += mixture.N_up[speciesIdx][i];
      } else { // TODO: move up. This is (probably) in most cases true
        for (i = 0; i < numberOfSpecies; i++)
          uptake += mixture.N_up[i][layerIdx];
      }
    }

    return uptake;
    
  };

  /* [kg (N) m-2] */
  var potentialNitrogenUptake = function (speciesIdx) {

    var uptake = 0, i = 0;

    if (speciesIdx === undefined) {
      for (i = 0; i < numberOfSpecies; i++)
        uptake += mixture[i].vars.N_req;
    } else {
      uptake = mixture[speciesIdx].vars.N_req;
    }

    return uptake;
    
  };

  var accumulatedEvapotranspiration = function () {
    return vc_accumulatedETa;
  };


  /* [kg (DM) ha-1] */
  var biomass = function (organIdx, speciesIdx) {

    var mass = 0;
    if (organIdx === undefined && speciesIdx === undefined) {
      mass = mixture.DM_shoot() + mixture.DM_root();
    } else if (organIdx !== undefined && speciesIdx !== undefined) {
      if (organIdx === ORGAN_ROOT)
        mass = mixture[speciesIdx].DM_root();
      else if (organIdx === ORGAN_LEAF)
        mass = mixture[speciesIdx].DM_leaf();
      else if (organIdx === ORGAN_STEM)
        mass = mixture[speciesIdx].DM_stem();
      else
        mass = 0;
    } else {
      if (organIdx === undefined) {
        var species = mixture[speciesIdx];
        mass = species.DM_leaf() + species.DM_stem() + species.DM_root();
      } else {
        if (organIdx === ORGAN_ROOT)
          mass = mixture.DM_root();
        else if (organIdx === ORGAN_LEAF)
          mass = mixture.DM_leaf();
        else if (organIdx === ORGAN_STEM)
          mass = mixture.DM_stem();
        else
          mass = 0;
      }
    }

    return mass * SQM_PER_HA;

  };


  /* [kg (CH2O) ha-1] */
  var grossPhotosynthate = function (speciesIdx) {

    var P_g = 0;
    if (species === undefined) {
      for (var i = 0; i < numberOfSpecies; i++)
        P_g += mixture[i].vars.P_g_day;      
    } else {
      P_g = mixture[speciesIdx].vars.P_g_day; 
    }
    // [kg C ha-1] to [kg CH2O ha-1]
    return P_g / 12 * 30 * SQM_PER_HA;

  };

  /* [kg (CH2O) ha-1] */
  var netPhotosynthate = function () {

    var G = 0;
    if (species === undefined) {
      for (var i = 0; i < numberOfSpecies; i++)
        G += mixture[i].vars.G;      
    } else {
      G = mixture[speciesIdx].vars.G; 
    }
    // [kg C ha-1] to [kg CH2O ha-1]
    return G / 12 * 30 * SQM_PER_HA;
    
  };


  /* [kg (N) kg-1 (DM)] */
  var shootBiomassNitrogenConcentration = function (speciesIdx) {

    return (speciesIdx === undefined ? mixture.f_N_live_shoot_DM() : mixture[speciesIdx].f_N_live_shoot_DM());

  };

  /* [kg (N) kg-1 (DM)] */
  var rootNitrogenConcentration = function (speciesIdx) {

    return (speciesIdx === undefined ? mixture.f_N_root_DM() : mixture[speciesIdx].f_N_root_DM());

  };

  /* [m] */
  var height = function (idx) {

    // if (idx !== undefined)
    //   return mixture[idx].h();

    // // avg height
    // var h_avg = 0;
    // for (var s = 0; s < numberOfSpecies; s++) {

    //   var species = mixture[s];
    //   h_avg += species.h();// * species.cons.f_cover;  

    // }

    return mixture.h();

  };

  /* [-] */
  var kcFactor = function (idx) {

    return vc_KcFactor;

  };

  /* [m2 m-2] */
  var leafAreaIndex = function (idx) {

    return (idx === undefined) ? mixture.L_tot() : mixture[idx].L();

  };

  /* array, per organic soil layer [AOM_Properties] TODO: implement in generic crop as well */
  var senescencedTissue = function () {

    var AOM = [];
    /* assume a rate for OM flux from litter to soil. TODO: value in SGS? */
    var f_litter = 0.1;

    for (var l = 0; l < vs_NumberOfOrganicLayers; l++) {

      var aom = new AOM_Properties();
      var N = 0;

      for (var s = 0; s < numberOfSpecies; s++) {

        var species = mixture[s] 
          , vars = species.vars 
          , Λ_r = vars.Λ_r
          , Λ_litter = vars.Λ_litter
            /* [m-1] due to maxMineralizationDepth vs_NumberOfOrganicLayers might be < root depth TODO: what to do with OM below min. depth? */
          , scale = mixture.f_r[s][l] / mixture.f_r_sum[s] / vs_LayerThickness
          ;

        /* include litter */
        if (l === 0) {
          aom.vo_AOM_Slow += (Λ_litter.sc + Λ_litter.nc + Λ_litter.pn) * f_litter / vs_LayerThickness;
          N += Λ_litter.pn  * f_litter / fC_pn * fN_pn  / vs_LayerThickness;
          Λ_litter.sc *= 1 - f_litter;
          Λ_litter.nc *= 1 - f_litter;
          Λ_litter.pn *= 1 - f_litter;
        }

        aom.vo_AOM_Slow += (Λ_r.sc + Λ_r.nc + Λ_r.pn) * scale;
        N += Λ_r.pn / fC_pn * fN_pn * scale;

      }

      aom.vo_CN_Ratio_AOM_Slow = (aom.vo_AOM_Slow === 0) ? 0 : (N === 0) ? 200 : aom.vo_AOM_Slow / N;
      /* check for null AOM in soilOrganic */
      AOM[l] = aom;
    }

    // reset Λ_r
    for (var s = 0; s < numberOfSpecies; s++) {
      var Λ_r = mixture[s].vars.Λ_r;
      Λ_r.sc = Λ_r.nc = Λ_r.pn = 0;
    }

    return AOM;

  };

  /* [0-1] */
  var GLF_water = function (speciesIdx) {    
    return (speciesIdx === undefined) ? mixture.Ω_water() : mixture[speciesIdx].vars.Ω_water;
  };

  /* [0-1] */
  var GLF_nitrogen = function (speciesIdx) {    
    return (speciesIdx === undefined) ? mixture.Ω_N() : mixture[speciesIdx].vars.Ω_N;
  };

  /* [0-1] */
  var GLF_lowTemperature = function (speciesIdx) {    
    return (speciesIdx === undefined) ? mixture.τ_T_low() : mixture[speciesIdx].vars.τ_T_low;
  };

  /* [0-1] */
  var GLF_highTemperature = function (speciesIdx) {    
    return (speciesIdx === undefined) ? mixture.τ_T_high() : mixture[speciesIdx].vars.τ_T_high;
  };

  /* rate [animals ha-1] currently size/weight does not matter */
  var setStockingRate = function (rate) {
    ρ_stock = rate;
  };

  return Object.create(CropGrowthAPI.prototype, {

    step: { value: step },
    name: { value: function () { return 'grassland'; } },
    height: { value: height },
    kcFactor: { value: kcFactor },
    leafAreaIndex: { value: leafAreaIndex },
    numberOfOrgans: { value: function () { return 3; } },
    numberOfSpecies: { value: function () { return numberOfSpecies; } },
    soilCoverage: { value: soilCoverage },
    stomataResistance: { value: stomataResistance },
    rootingDepth: { value: rootingDepth },

    nitrogenStress: { value: GLF_nitrogen },
    heatStress: { value: GLF_highTemperature },
    waterStress: { value: GLF_water },
    biomass: { value: biomass },
    
    growthIncrement: { value: growthIncrement },
    // biomass: { value: biomass },
    shootBiomass: { value: shootBiomass },
    shootBiomassNitrogenConcentration: { value: shootBiomassNitrogenConcentration },
    rootBiomass: { value: rootBiomass },
    rootNitrogenConcentration: { value: rootNitrogenConcentration },
    netPhotosynthate: { value: netPhotosynthate },
    grossPhotosynthate: { value: grossPhotosynthate },

    // primaryYield: { value: get_PrimaryCropYield },
    // primaryYieldFreshMatter: { value: get_FreshPrimaryCropYield },
    // primaryYieldNitrogenConcentration: { value: get_PrimaryYieldNConcentration },
    // primaryYieldNitrogenContent: { value: get_PrimaryYieldNContent },
    // primaryYieldCrudeProteinConcentration: { value: get_RawProteinConcentration },
    
    // secondaryYield: { value: get_SecondaryCropYield },
    // secondaryYieldNitrogenConcentration: { value: get_ResiduesNConcentration },
    // secondaryYieldNitrogenContent: { value: get_SecondaryYieldNContent },
    // residueBiomass: { value: get_ResidueBiomass },
    // residuesNitrogenConcentration: { value: get_ResiduesNConcentration },
    // residuesNitrogenContent: { value: get_ResiduesNContent },
    
    referenceEvapotranspiration: { value: referenceEvapotranspiration },
    accumulatedEvapotranspiration: { value: accumulatedEvapotranspiration },
    // accumulateEvapotranspiration: { value: accumulateEvapotranspiration },
    remainingEvapotranspiration: { value: remainingEvapotranspiration },
    transpiration: { value: transpired },
    potentialTranspiration: { value: potentialTranspiration },
    evaporatedFromIntercept: { value: evaporatedFromIntercept },
    netPrecipitation: { value: netPrecipitation },

    nitrogenUptake: { value: actualNitrogenUptake },
    potentialNitrogenUptake: { value: potentialNitrogenUptake },
    // accumulatedNitrogenUptake: { value: get_SumTotalNUptake },
    
    // currentTemperatureSum: { value: get_CurrentTemperatureSum },

    senescencedTissue: { value: senescencedTissue },

    /* grassland */
    shootBiomassByHeight: { value: shootBiomassByHeight },
    shootOrganicMatterDigestibility: { value: shootOrganicMatterDigestibility },
    shootOrganicMatterContent: { value: shootOrganicMatterContent },
    shootCrudeProteinContent: { value: shootCrudeProteinContent },
    shootCrudeFibreContent: { value: shootCrudeFibreContent },

    setStockingRate: { value: setStockingRate },

    harvestShootBiomassByHeight: { value: harvestShootBiomassByHeight },
    harvestShootBiomass: { value: harvestShootBiomass }

  });  

};
