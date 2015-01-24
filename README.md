_work in progress_

crop.js
=======

crop.js is an effort to build a dynamic (generic) crop and grassland growth model entirly in JavaScript.

## Genealogy
The (generic) crop and soil model is a JS port of [MONICA](http://monica.agrosystem-models.com/). MONICA is based on [HERMES](http://www.zalf.de/en/forschung/institute/lsa/forschung/oekomod/hermes/Pages/default.aspx) and [DAISY](https://code.google.com/p/daisy-model/). HERMES is based on [SUCROS](http://models.pps.wur.nl/node/3). The grassland model is based on the [SGS Pasture Model](http://imj.com.au/sgs/), which implements various [Thornley&Johnson](http://scholar.google.de/scholar?q=Thornley+Johnson+grass) models and approaches.

## Aims
- Replace MONICA's generic grass-legume model with a more sophisticated grassland model.
- Provide additional nutritional parameters (e.g. digestibility) for forage crops (e.g. maize, whole-crop silage) that may be used by animal (ruminants) models.
- Add simple rountines for automatic seed, harvest, fertilization, irrigation and tillage date predictions.
- Simplify MONICA's input parameters, configuration and API.
- Add simple calibration routine (phenology).

## Acknowledgements

We gratefully acknowledge funding from the European Community´s 7th Framework Programme (FP7/2007-2013) under the grant 
agreement number FP7-266367 (Sustainable organic and low input dairying).
