const ptv = require('ptv-api');
require('dotenv').config();

const devid = process.env.DEV_ID;
const apikey = process.env.API_KEY;

const TYPES = {
  train: 0,
  tram: 1,
  bus: 2,
  vline: 3,
  nightbus: 4,
};

let ptvClient;

async function getDirection(routeId, toCity = false) {
  const response = await ptvClient.Directions.Directions_ForRoute({ route_id: routeId });
  return response.body.directions.filter(direction => !toCity ^ direction.direction_name.includes('City'))[0];
}

async function getStop(name, type = TYPES.train) {
  const response = await ptvClient.Search.Search_Search({
    search_term: name,
    route_types: [type],
    include_outlets: false,
  });
  return response.body.stops[0];
}

async function getDeparturesForStop(
  stopId,
  type = TYPES.train,
  limit = 1,
  date_utc = new Date().toISOString(),
  directionIds = [],
) {
  const response = await ptvClient.Departures.Departures_GetForStop({
    route_type: type,
    stop_id: stopId,
    max_results: limit,
    date_utc,
  });
  const departures = response.body.departures
    .filter(departure => departure.estimated_departure_utc)
    .map(departure => {
      const localTime = (new Date(departure.estimated_departure_utc)).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
      return {
        ...departure,
        estimated_departure: localTime,
        delay: Math.round((new Date(departure.estimated_departure_utc) - new Date(departure.scheduled_departure_utc)) / 1000 / 60),
      };
    })
    .filter(departure => directionIds.length === 0 || directionIds.includes(departure.direction_id))
    .sort((a, b) => new Date(a.estimated_departure_utc) - new Date(b.estimated_departure_utc))
  ;

  return departures;
}

async function main() {
  ptvClient = await ptv(devid, apikey); 
  const stops = await getStop('Flinders Street');
  const directions = await Promise.all(stops.routes.map(route => getDirection(route.route_id)));
  const departures = (await getDeparturesForStop(
    stops.stop_id,
    TYPES.train,
    2,
    new Date().toISOString(),
    directions.map(direction => direction.direction_id),
  )).map(departure => ({
    ...departure,
    route_name: stops.routes.find(route => route.route_id === departure.route_id).route_name,
    direction_name: directions.find(direction => direction.direction_id === departure.direction_id).direction_name,
  }));
  console.dir(departures);
}

main();
