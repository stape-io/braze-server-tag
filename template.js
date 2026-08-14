const computeEffectiveTldPlusOne = require('computeEffectiveTldPlusOne');
const generateRandom = require('generateRandom');
const getAllEventData = require('getAllEventData');
const getEventData = require('getEventData');
const getCookieValues = require('getCookieValues');
const getRequestHeader = require('getRequestHeader');
const getTimestampMillis = require('getTimestampMillis');
const getType = require('getType');
const JSON = require('JSON');
const logToConsole = require('logToConsole');
const makeInteger = require('makeInteger');
const makeNumber = require('makeNumber');
const makeString = require('makeString');
const Math = require('Math');
const Object = require('Object');
const sendHttpRequest = require('sendHttpRequest');
const setCookie = require('setCookie');

/*==============================================================================
==============================================================================*/

// Braze's own '/users/identify' endpoint only merges alias-only, email-only, or phone-only
// profiles into an 'external_id' profile ('braze_id' is not a valid input there). So the
// anonymous, cookie-backed identifier is sent as a 'user_alias' instead of 'braze_id': that keeps
// the door open to reconcile anonymous history once the user becomes identified. It's intentionally
// called "Anonymous Alias" (not "Braze ID") to avoid confusion with the real braze_id/device_id set
// by the client SDK.
const ANONYMOUS_ALIAS_LABEL = 'anonymous_alias_cookie';

const eventData = getAllEventData();

if (!isConsentGivenOrNotRequired(data, eventData)) {
  return data.gtmOnSuccess();
}

const url = eventData.page_location || getRequestHeader('referer');
if (url && url.lastIndexOf('https://gtm-msr.appspot.com/', 0) === 0) {
  return data.gtmOnSuccess();
}

if (data.action === 'identifyUser') {
  identifyUser(eventData);
} else {
  trackUser(eventData);
}

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
        Message: '🛑 [ERROR] Event was not sent.',
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

  addAnonymousIdentity(userIdentifiers, eventData);

  applyPrimaryIdentifierPrecedence(userIdentifiers);

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

// When no primary identifier ('external_id', 'braze_id' or 'user_alias') is already set, falls
// back to a cookie-backed anonymous 'user_alias' so the request always has an identifier. Merging
// that anonymous alias into an 'external_id' profile once the user is known is a separate, explicit
// "Identify User" action (see identifyUser()) rather than an automatic side effect of Track Event.
function addAnonymousIdentity(userIdentifiers, eventData) {
  if (
    isValidValue(userIdentifiers.external_id) ||
    isValidValue(userIdentifiers.braze_id) ||
    isValidValue(userIdentifiers.user_alias)
  ) {
    return;
  }

  const aliasName = getAnonymousAliasName(eventData, true);
  if (!aliasName) return;

  userIdentifiers.user_alias = { alias_label: ANONYMOUS_ALIAS_LABEL, alias_name: aliasName };
  userIdentifiers['_update_existing_only'] = false;
  storeAnonymousAliasCookie(aliasName);
}

function getAnonymousAliasName(eventData, allowGenerate) {
  const aliasName = getCookieValues('__braze_anon_alias')[0] || eventData.braze_id;

  if (aliasName) return aliasName;

  if (allowGenerate && data.setAnonymousAliasCookie) return generateUUID();
}

function storeAnonymousAliasCookie(aliasName) {
  if (!data.setAnonymousAliasCookie) return;

  setCookie(
    '__braze_anon_alias',
    aliasName,
    {
      domain: getCookieDomain(data.cookieDomain),
      samesite: data.cookieSameSite || 'None',
      path: '/',
      secure: true,
      httpOnly: !!data.cookieHttpOnly,
      'max-age': 60 * 60 * 24 * makeInteger(data.cookieExpiration || 365)
    },
    false
  );
}

// Explicit "Identify User" action: merges an existing anonymous alias profile into an
// 'external_id' profile via '/users/identify'. Never generates a new alias -- if there's no
// existing anonymous alias to merge, there's nothing for this action to do.
function identifyUser(eventData) {
  const userIdentifiers = {};
  if (data.userIdentifiersList) {
    data.userIdentifiersList.forEach((d) => (userIdentifiers[d.name] = d.value));
  }

  const externalId = userIdentifiers.external_id;
  const aliasName = getAnonymousAliasName(eventData, false);

  if (!isValidValue(externalId) || !aliasName) {
    log({
      Name: 'Braze',
      Type: 'Message',
      Message: '🛑 [ERROR] Identify User was not sent.',
      Reason:
        'Requires both an "external_id" (User Identifiers) and an existing anonymous alias (cookie or Event Data) to merge.'
    });

    return data.gtmOnFailure();
  }

  storeAnonymousAliasCookie(aliasName);

  return sendRequest({
    path: '/users/identify',
    body: {
      aliases_to_identify: [
        {
          external_id: externalId,
          user_alias: {
            alias_label: ANONYMOUS_ALIAS_LABEL,
            alias_name: aliasName
          }
        }
      ]
    },
    method: 'POST'
  });
}

// Braze allows only one primary identifier per request. Ref: https://braze.com/docs/api/endpoints/user_data/post_user_track/#identifier-resolution
function applyPrimaryIdentifierPrecedence(userIdentifiers) {
  if (isValidValue(userIdentifiers.external_id)) {
    Object.delete(userIdentifiers, 'braze_id');
    Object.delete(userIdentifiers, 'user_alias');
    Object.delete(userIdentifiers, '_update_existing_only');
  } else if (isValidValue(userIdentifiers.braze_id)) {
    Object.delete(userIdentifiers, 'user_alias');
    Object.delete(userIdentifiers, '_update_existing_only');
  }
}

function sendRequest(requestData) {
  const url = data.apiEndpoint + requestData.path;
  return sendHttpRequest(
    url,
    (statusCode, headers, body) => {
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

function random() {
  return generateRandom(1000000000000000, 10000000000000000) / 10000000000000000;
}

function generateUUID() {
  function s(n) {
    return h((random() * (1 << (n << 2))) ^ getTimestampMillis()).slice(-n);
  }
  function h(n) {
    return (n | 0).toString(16);
  }
  return [
    s(4) + s(4),
    s(4),
    '4' + s(3),
    h(8 | (random() * 4)) + s(3),
    getTimestampMillis().toString(16).slice(-10) + s(2)
  ].join('-');
}

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
  return valueType !== 'null' && valueType !== 'undefined' && value !== '' && value === value;
}

function mergeObj(target, source) {
  for (const key in source) {
    if (source.hasOwnProperty(key)) target[key] = source[key];
  }
  return target;
}

function getCookieDomain(defaultCookieDomain) {
  return !defaultCookieDomain || defaultCookieDomain === 'auto'
    ? computeEffectiveTldPlusOne(getEventData('page_location') || getRequestHeader('referer')) ||
        'auto'
    : defaultCookieDomain;
}

function isConsentGivenOrNotRequired(data, eventData) {
  if (data.adStorageConsent !== 'required') return true;
  if (eventData.consent_state) return !!eventData.consent_state.ad_storage;
  const xGaGcs = eventData['x-ga-gcs'] || ''; // x-ga-gcs is a string like "G110"
  return xGaGcs[2] === '1';
}

function log(rawDataToLog) {
  rawDataToLog.TraceId = getRequestHeader('trace-id');
  logToConsole(JSON.stringify(rawDataToLog));
}
