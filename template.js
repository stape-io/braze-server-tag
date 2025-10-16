const getAllEventData = require('getAllEventData');
const JSON = require('JSON');
const sendHttpRequest = require('sendHttpRequest');
const getTimestampMillis = require('getTimestampMillis');
const getContainerVersion = require('getContainerVersion');
const logToConsole = require('logToConsole');
const getRequestHeader = require('getRequestHeader');
const makeString = require('makeString');
const makeInteger = require('makeInteger');
const makeNumber = require('makeInteger');
const Math = require('Math');
const getType = require('getType');
const BigQuery = require('BigQuery');

/*==============================================================================
==============================================================================*/

const eventData = getAllEventData();

if (!isConsentGivenOrNotRequired(data, eventData)) {
  return data.gtmOnSuccess();
}

const url = eventData.page_location || getRequestHeader('referer');
if (url && url.lastIndexOf('https://gtm-msr.appspot.com/', 0) === 0) {
  return data.gtmOnSuccess();
}

trackUser(eventData);

if (data.useOptimisticScenario) {
  return data.gtmOnSuccess();
}

/*==============================================================================
  Vendor related functions
==============================================================================*/

function trackUser(eventData) {
  const mappedTrackUserData = mapEventData(eventData);

  for (const key in mappedTrackUserData) {
    if (
      getType(mappedTrackUserData[key]) === 'array' &&
      mappedTrackUserData[key].length &&
      areThereMissingRequiredIdentifiers(mappedTrackUserData[key][0])
    ) {
      log({
        Name: 'Braze',
        Type: 'Message',
        EventName: data.eventType,
        Message: 'Event was not sent.',
        Reason:
          'One or more fields are missing: "external_id" or "user_alias" or "braze_id" or "email" or "phone".'
      });

      return data.gtmOnFailure();
    }
  }

  return sendRequest({
    path: '/users/track',
    body: mappedTrackUserData,
    method: 'POST'
  });
}

function mapEventData(eventData) {
  let mappedData = {
    events: undefined,
    purchases: undefined,
    attributes: undefined
  };

  mappedData = addEventData(eventData, mappedData);
  mappedData = addUserData(eventData, mappedData);

  return mappedData;
}

function addEventData(eventData, mappedData) {
  const event = {
    time: data.eventTimestamp || convertTimestampToISO(getTimestampMillis()),
    properties: {}
  };

  if (isValidValue(data.appId)) {
    event.app_id = makeString(data.appId);
  }

  if ([true, 'true'].indexOf(data.includeCommonEventData) !== -1) {
    [
      'page_location',
      'page_title',
      'page_referrer',
      'page_hostname',
      'page_encoding',
      'screen_resolution',
      'user_agent',
      'language'
    ].forEach((parameter) => {
      if (!isValidValue(eventData[parameter])) return;
      event.properties[parameter] = eventData[parameter];
    });
  }

  const eventName = data.eventType === 'purchase' ? data.eventType : data.eventNameCustom;
  if (eventName === 'purchase') {
    // Ref: https://braze.com/docs/api/objects_filters/purchase_object/#log-purchases-at-the-order-level
    event.product_id = data.purchaseProductId;
    event.currency = data.purchaseCurrency;
    event.price = makeNumber(data.purchasePrice);

    if (data.purchaseTransactionId) event.properties.transaction_id = data.purchaseTransactionId;

    if (data.purchaseProducts) {
      event.properties.products = data.purchaseProducts;
    } else if (eventData.items && eventData.items[0]) {
      event.properties.products = [];

      eventData.items.forEach((d) => {
        const product = {};
        if (d.item_id) product.product_id = makeString(d.item_id);
        if (d.quantity) product.quantity = makeInteger(d.quantity);
        if (d.item_category) product.category = d.item_category;
        if (d.product_group) product.product_group = d.product_group;
        if (d.price) {
          product.price = makeString(d.price);
        }
        event.properties.products.push(product);
      });
    }

    mappedData.purchases = [event];
  } else {
    event.name = eventName;
    mappedData.events = [event];
  }

  if (data.eventCustomDataList) {
    data.eventCustomDataList.forEach((d) => (event.properties[d.name] = d.value));
  }

  return mappedData;
}

function addUserData(eventData, mappedData) {
  const userIdentifiers = {};

  const eventDataUserData = eventData.user_data || {};

  if (eventData.email) userIdentifiers.email = eventData.email;
  else if (eventDataUserData.email_address) userIdentifiers.email = eventDataUserData.email_address;
  else if (eventDataUserData.email) userIdentifiers.email = eventDataUserData.email;

  if (eventData.phone) userIdentifiers.phone = eventData.phone;
  else if (eventDataUserData.phone_number) userIdentifiers.phone = eventDataUserData.phone_number;

  if (data.addUserAlias && isValidValue(data.userAliasLabel) && isValidValue(data.userAliasName)) {
    userIdentifiers.user_alias = {};
    userIdentifiers.user_alias.alias_label = data.userAliasLabel;
    userIdentifiers.user_alias.alias_name = data.userAliasName;
    userIdentifiers['_update_existing_only'] =
      [true, 'true'].indexOf(data.updateExistingUsersOnly) !== -1;
  }

  if (data.userIdentifiersList) {
    data.userIdentifiersList.forEach((d) => (userIdentifiers[d.name] = d.value));
  }

  // It's required to have user data in other entities ('purchases' or 'events') in top level.
  ['events', 'purchases'].forEach((key) => {
    const entity = mappedData[key];
    if (getType(entity) !== 'array' || entity.length === 0) return;
    mergeObj(mappedData[key][0], userIdentifiers);
  });

  const userAttributes = {};
  if (data.userCustomDataList) {
    data.userCustomDataList.forEach((d) => (userAttributes[d.name] = d.value));
  }

  mappedData.attributes = [mergeObj(userAttributes, userIdentifiers)];

  return mappedData;
}

function sendRequest(requestData) {
  const url = data.apiEndpoint + requestData.path;

  log({
    Name: 'Braze',
    Type: 'Request',
    EventName: requestData.path,
    RequestMethod: requestData.method,
    RequestUrl: url,
    RequestBody: requestData.body
  });

  return sendHttpRequest(
    url,
    (statusCode, headers, body) => {
      log({
        Name: 'Braze',
        Type: 'Response',
        EventName: requestData.path,
        ResponseStatusCode: statusCode,
        ResponseHeaders: headers,
        ResponseBody: body
      });

      let parsedBody = {};
      if (body) parsedBody = JSON.parse(body);

      if (!data.useOptimisticScenario) {
        if (statusCode >= 200 && statusCode < 400 && !parsedBody.errors) {
          data.gtmOnSuccess();
        } else {
          data.gtmOnFailure();
        }
      }
    },
    {
      headers: generateRequestHeaders(requestData.method),
      method: requestData.method
    },
    requestData.body ? JSON.stringify(requestData.body) : undefined
  );
}

function generateRequestHeaders(method) {
  const headers = {
    Authorization: 'Bearer ' + data.apiKey
  };

  if (['POST'].indexOf(method) !== -1) {
    headers['Content-Type'] = 'application/json';
  }

  return headers;
}

function areThereMissingRequiredIdentifiers(obj) {
  const requiredIdentifiers = ['email', 'phone', 'braze_id', 'external_id', 'user_alias'];

  const missingRequiredIdentifiers = requiredIdentifiers.every((id) => {
    if (id === 'user_alias') {
      return (
        !isValidValue(obj[id]) ||
        !isValidValue(obj[id].alias_label) ||
        !isValidValue(obj[id].alias_name)
      );
    }
    return !isValidValue(obj[id]);
  });

  if (missingRequiredIdentifiers) return true;
  return false;
}

/*==============================================================================
  Helpers
==============================================================================*/

function convertTimestampToISO(timestamp) {
  const leapYear = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const nonLeapYear = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const secToMs = (s) => s * 1000;
  const minToMs = (m) => m * secToMs(60);
  const hoursToMs = (h) => h * minToMs(60);
  const daysToMs = (d) => d * hoursToMs(24);
  const padStart = (value, length) => {
    let result = makeString(value);
    while (result.length < length) {
      result = '0' + result;
    }
    return result;
  };

  const fourYearsInMs = daysToMs(365 * 4 + 1);
  let year = 1970 + Math.floor(timestamp / fourYearsInMs) * 4;
  timestamp = timestamp % fourYearsInMs;

  while (true) {
    let isLeapYear = year % 4 === 0;
    let nextTimestamp = timestamp - daysToMs(isLeapYear ? 366 : 365);
    if (nextTimestamp < 0) {
      break;
    }
    timestamp = nextTimestamp;
    year = year + 1;
  }

  const daysByMonth = year % 4 === 0 ? leapYear : nonLeapYear;

  let month = 0;
  for (let i = 0; i < daysByMonth.length; i++) {
    const msInThisMonth = daysToMs(daysByMonth[i]);
    if (timestamp > msInThisMonth) {
      timestamp = timestamp - msInThisMonth;
    } else {
      month = i + 1;
      break;
    }
  }

  const date = Math.ceil(timestamp / daysToMs(1));
  timestamp = timestamp - daysToMs(date - 1);
  const hours = Math.floor(timestamp / hoursToMs(1));
  timestamp = timestamp - hoursToMs(hours);
  const minutes = Math.floor(timestamp / minToMs(1));
  timestamp = timestamp - minToMs(minutes);
  const sec = Math.floor(timestamp / secToMs(1));
  timestamp = timestamp - secToMs(sec);
  const milliSeconds = timestamp;

  return (
    year +
    '-' +
    padStart(month, 2) +
    '-' +
    padStart(date, 2) +
    'T' +
    padStart(hours, 2) +
    ':' +
    padStart(minutes, 2) +
    ':' +
    padStart(sec, 2) +
    '.' +
    padStart(milliSeconds, 3) +
    'Z'
  );
}

function isValidValue(value) {
  const valueType = getType(value);
  return valueType !== 'null' && valueType !== 'undefined' && value !== '';
}

function mergeObj(target, source) {
  for (const key in source) {
    if (source.hasOwnProperty(key)) target[key] = source[key];
  }
  return target;
}

function isConsentGivenOrNotRequired(data, eventData) {
  if (data.adStorageConsent !== 'required') return true;
  if (eventData.consent_state) return !!eventData.consent_state.ad_storage;
  const xGaGcs = eventData['x-ga-gcs'] || ''; // x-ga-gcs is a string like "G110"
  return xGaGcs[2] === '1';
}

function log(rawDataToLog) {
  const logDestinationsHandlers = {};
  if (determinateIsLoggingEnabled()) logDestinationsHandlers.console = logConsole;
  if (determinateIsLoggingEnabledForBigQuery()) logDestinationsHandlers.bigQuery = logToBigQuery;

  rawDataToLog.TraceId = getRequestHeader('trace-id');

  const keyMappings = {
    // No transformation for Console is needed.
    bigQuery: {
      Name: 'tag_name',
      Type: 'type',
      TraceId: 'trace_id',
      EventName: 'event_name',
      RequestMethod: 'request_method',
      RequestUrl: 'request_url',
      RequestBody: 'request_body',
      ResponseStatusCode: 'response_status_code',
      ResponseHeaders: 'response_headers',
      ResponseBody: 'response_body'
    }
  };

  for (const logDestination in logDestinationsHandlers) {
    const handler = logDestinationsHandlers[logDestination];
    if (!handler) continue;

    const mapping = keyMappings[logDestination];
    const dataToLog = mapping ? {} : rawDataToLog;

    if (mapping) {
      for (const key in rawDataToLog) {
        const mappedKey = mapping[key] || key;
        dataToLog[mappedKey] = rawDataToLog[key];
      }
    }

    handler(dataToLog);
  }
}

function logConsole(dataToLog) {
  logToConsole(JSON.stringify(dataToLog));
}

function logToBigQuery(dataToLog) {
  const connectionInfo = {
    projectId: data.logBigQueryProjectId,
    datasetId: data.logBigQueryDatasetId,
    tableId: data.logBigQueryTableId
  };

  dataToLog.timestamp = getTimestampMillis();

  ['request_body', 'response_headers', 'response_body'].forEach((p) => {
    dataToLog[p] = JSON.stringify(dataToLog[p]);
  });

  BigQuery.insert(connectionInfo, [dataToLog], { ignoreUnknownValues: true });
}

function determinateIsLoggingEnabled() {
  const containerVersion = getContainerVersion();
  const isDebug = !!(
    containerVersion &&
    (containerVersion.debugMode || containerVersion.previewMode)
  );

  if (!data.logType) {
    return isDebug;
  }

  if (data.logType === 'no') {
    return false;
  }

  if (data.logType === 'debug') {
    return isDebug;
  }

  return data.logType === 'always';
}

function determinateIsLoggingEnabledForBigQuery() {
  if (data.bigQueryLogType === 'no') return false;
  return data.bigQueryLogType === 'always';
}
