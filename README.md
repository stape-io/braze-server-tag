# Braze Tag for Google Tag Manager Server-Side

The **Braze Tag for Google Tag Manager Server-Side** allows you to send events, update user profiles, and track purchases to Braze directly from the server container - making it easy to track user behavior and update records.

### Getting Started

1. Add the **Braze tag** to your server Google Tag Manager container.
2. Choose the **Action**: `Track Event` (send an event/purchase/user update to `/users/track`) or `Identify User` (merge an anonymous alias into an `external_id` profile via `/users/identify`).
3. Set the **Braze REST API Endpoint** (e.g. `https://rest.iad-01.braze.com`).
4. Add your **Braze API Key** (must include the `users.track` permission for the `Track Event` action, and the `users.identify` permission for the `Identify User` action).
5. Add your **Braze App ID** (you can find it under your App Settings or APIs and Identifiers configuration)
6. For `Track Event`, choose the **Event Type** you want to send (`purchase` or custom).
7. Set user identifiers (**at least one user identifier is required**) and optional user alias.
8. Add custom event properties and user profile attributes.

### Supported Actions

- **Track Event**: send data to Braze's `/users/track` endpoint.
  - **Custom Event**: Track any custom event.
  - **Purchase Event**: Track purchases (order-level or product-level).
  - **User Profile Update**: Update user attributes in Braze (e.g., email, phone, external ID, user aliases).
  - Associate **user aliases** (e.g. external ID to Braze ID)
  - Send event **context data** (e.g. page location, user agent)
- **Identify User**: merge an anonymous alias profile into an `external_id` profile via Braze's `/users/identify` endpoint. See [Anonymous User Identification](#anonymous-user-identification) below.

### Anonymous User Identification

When a `Track Event` has no identifier at all, the tag can generate and track an anonymous user so
Braze never receives an event without an identifier:

- It reads an existing anonymous alias from the `__braze_anon_alias` cookie (set by this tag) or the
  `braze_id` Event Data parameter; if neither exists, it generates a new UUID.
- This anonymous identifier is sent as a `user_alias`, **not** `braze_id`, because Braze's
  `/users/identify` endpoint — the only way to merge an anonymous profile into an identified one —
  only accepts alias-only, email-only, or phone-only profiles, never `braze_id`. It's deliberately
  not called "Braze ID" to avoid confusion with the real `braze_id`/device ID set by the Braze
  client-side SDK.
- Merging that anonymous alias into an identified user is **not automatic** — it requires a separate
  tag configured with the **Identify User** action, using an `external_id` User Identifier and
  targeting a trigger that fires once the user becomes known (e.g. on login/sign-up), rather than on
  every tracked event. This avoids repeated, redundant `/users/identify` calls and gives explicit
  control over exactly when the merge happens.
- This is controlled by the **Set Anonymous Alias cookie** checkbox (enabled by default); disabling
  it stops cookie generation/storage (an existing alias is still sent, just not persisted). Only one
  primary identifier (`external_id` > `braze_id` > `user_alias`) is ever sent per request, and a
  manually configured `braze_id` or user alias always takes precedence over the automatic one.
  The **Identify User** action never generates a new alias — it only merges an alias that already
  exists, and fails the tag if either the `external_id` or the existing alias is missing.

## Open Source

The **Braze Tag for Google Tag Manager Server-Side** is developed and maintained by the [Stape Team](https://stape.io/) under the Apache 2.0 license.

### GTM Gallery Status
🟢 [Listed](https://tagmanager.google.com/gallery/#/owners/stape-io/templates/braze-server-tag)
