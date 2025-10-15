# Braze Tag for Google Tag Manager Server-Side

The **Braze Tag for Google Tag Manager Server-Side** allows you to send events, update user profiles, and track purchases to Braze directly from the server container - making it easy to track user behavior and update records.

### Getting Started

1. Add the **Braze tag** to your server Google Tag Manager container.
2. Set the **Braze REST API Endpoint** (e.g. `https://rest.iad-01.braze.com`).
3. Add your **Braze API Key** (must include the `users.track` permission).
4. Add your **Braze App ID** (you can find it under your App Settings or APIs and Identifiers configuration)
5. Choose the **Event Type** you want to send (`purchase` or custom).
6. Set user identifiers (**at least one user identifier is required**) and optional user alias.
7. Add custom event properties and user profile attributes.

### Supported Actions

- **Custom Event**: Track any custom event.
- **Purchase Event**: Track purchases (order-level or product-level).
- **User Profile Update**: Update user attributes in Braze (e.g., email, phone, external ID, user aliases).
- Associate **user aliases** (e.g. external ID to Braze ID)
- Send event **context data** (e.g. page location, user agent)

## Open Source

The **Braze Tag for Google Tag Manager Server-Side** is developed and maintained by the [Stape Team](https://stape.io/) under the Apache 2.0 license.