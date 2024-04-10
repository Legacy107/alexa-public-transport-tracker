const Alexa = require('ask-sdk-core');

const SKILL_NAME = 'Victoria Public Transport Tracker';
const FALLBACK_MESSAGE = `The ${SKILL_NAME} skill can\'t help you with that. It can help you get realtime data for Victorian public transport.  What can I help you with?`;
const FALLBACK_REPROMPT = 'What can I help you with?';

const messages = {
  WELCOME: `Welcome to the ${SKILL_NAME}!  You can ask for realtime data of any public transport mode.  What do you want to ask?`,
  WHAT_DO_YOU_WANT: 'What do you want to ask?',
  NOTIFY_MISSING_PERMISSIONS: 'Please enable Location permissions in the Amazon Alexa app.',
  NO_ADDRESS: 'It looks like you don\'t have an address set. You can set your address from the companion app.',
  ADDRESS_AVAILABLE: 'Here is your full address: ',
  ERROR: 'Uh Oh. Looks like something went wrong.',
  LOCATION_FAILURE: 'There was an error with the Device Address API. Please try again.',
  GOODBYE: 'Bye! Thanks for using the Sample Device Address API Skill!',
  UNHANDLED: 'This skill doesn\'t support that. Please ask something else.',
  HELP: 'You can use this skill by asking something like: whats the next train at Flinder Street?',
  STOP: `Bye! Thanks for using ${SKILL_NAME}!`,

};

const PERMISSIONS = ['read::alexa:device:all:address'];

const ptv = require('ptv-api');
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
ptv(devid, apikey).then(client => {
  ptvClient = client;
})

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


// INTENT HANDLERS

const LaunchRequest = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'LaunchRequest';
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder.speak(messages.WELCOME)
      .reprompt(messages.WHAT_DO_YOU_WANT)
      .getResponse();
  },
};

const GetPublicTransportDataIntent = {
  canHandle(handlerInput) {
    const { request } = handlerInput.requestEnvelope;

    return request.type === 'IntentRequest' && request.intent.name === 'GetPublicTransportDataIntent';
  },
  /**
   * 
   * @param {HandlerInput} handlerInput 
   * @returns 
   */
  async handle(handlerInput) {
    const { requestEnvelope, attributesManager, serviceClientFactory, responseBuilder } = handlerInput;

    try {
      const { type, stop, direction } = attributesManager.getRequestAttributes();

      const stops = await getStop(stop.replace('street', ''));
      const directions = await Promise.all(stops.routes.map(route => getDirection(route.route_id, direction === 'to city')));
      const departures = (await getDeparturesForStop(
        stops.stop_id,
        TYPES[type] ?? TYPES.train,
        2,
        new Date().toISOString(),
        directions.map(direction => direction.direction_id),
      )).map(departure => ({
        ...departure,
        route_name: stops.routes.find(route => route.route_id === departure.route_id).route_name,
        direction_name: directions.find(direction => direction.direction_id === departure.direction_id).direction_name,
      }));
      const departure = departures[0];

      return responseBuilder.speak(`Next ${type} ${direction} is the ${departure.route_name} at ${departure.estimated_departure}`).getResponse();
    } catch (error) {
      if (error.name !== 'ServiceError') {
        const response = responseBuilder.speak(messages.ERROR).getResponse();
        return response;
      }
      throw error;
    }
  },
};

const SessionEndedRequest = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'SessionEndedRequest';
  },
  handle(handlerInput) {
    console.log(`Session ended with reason: ${handlerInput.requestEnvelope.request.reason}`);

    return handlerInput.responseBuilder.getResponse();
  },
};

const UnhandledIntent = {
  canHandle() {
    return true;
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder
      .speak(messages.UNHANDLED)
      .reprompt(messages.UNHANDLED)
      .getResponse();
  },
};

const HelpIntent = {
  canHandle(handlerInput) {
    const { request } = handlerInput.requestEnvelope;

    return request.type === 'IntentRequest' && request.intent.name === 'AMAZON.HelpIntent';
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder
      .speak(messages.HELP)
      .reprompt(messages.HELP)
      .getResponse();
  },
};

const CancelIntent = {
  canHandle(handlerInput) {
    const { request } = handlerInput.requestEnvelope;

    return request.type === 'IntentRequest' && request.intent.name === 'AMAZON.CancelIntent';
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder
      .speak(messages.GOODBYE)
      .getResponse();
  },
};

const StopIntent = {
  canHandle(handlerInput) {
    const { request } = handlerInput.requestEnvelope;

    return request.type === 'IntentRequest' && request.intent.name === 'AMAZON.StopIntent';
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder
      .speak(messages.STOP)
      .getResponse();
  },
};

const GetAddressError = {
  canHandle(handlerInput, error) {
    return error.name === 'ServiceError';
  },
  handle(handlerInput, error) {
    if (error.statusCode === 403) {
      return handlerInput.responseBuilder
        .speak(messages.NOTIFY_MISSING_PERMISSIONS)
        .withAskForPermissionsConsentCard(PERMISSIONS)
        .getResponse();
    }
    return handlerInput.responseBuilder
      .speak(messages.LOCATION_FAILURE)
      .reprompt(messages.LOCATION_FAILURE)
      .getResponse();
  },
};

const FallbackHandler = {
  // 2018-May-01: AMAZON.FallackIntent is only currently available in en-US locale.
  //              This handler will not be triggered except in that locale, so it can be
  //              safely deployed for any locale.
  canHandle(handlerInput) {
    const request = handlerInput.requestEnvelope.request;
    return request.type === 'IntentRequest'
      && request.intent.name === 'AMAZON.FallbackIntent';
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder
      .speak(FALLBACK_MESSAGE)
      .reprompt(FALLBACK_REPROMPT)
      .getResponse();
  },
};

const skillBuilder = Alexa.SkillBuilders.custom();

exports.handler = skillBuilder
  .addRequestHandlers(
    LaunchRequest,
    GetPublicTransportDataIntent,
    SessionEndedRequest,
    HelpIntent,
    CancelIntent,
    StopIntent,
    FallbackHandler,
    UnhandledIntent,
  )
  .addErrorHandlers(GetAddressError)
  .withApiClient(new Alexa.DefaultApiClient())
  .lambda();