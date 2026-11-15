# Real location capture and tracking

## What produces each point

- **Pickup/delivery:** new booking and staff order forms require a map-confirmed coordinate for each address. A user can place a pin or choose **Use my location** when physically at that address. No city, address or simulated GPS is used as a substitute. Editing address text clears its prior pin so it must be confirmed again.
- **Rider:** the rider's browser requests high-accuracy device geolocation while available or carrying an active order. It submits latitude, longitude, accuracy and the actual capture timestamp about every 10 seconds while the app is visible and online. Going unavailable for new jobs does not stop an existing delivery's foreground tracking.
- **Persistence:** order endpoint coordinates live on `Order`; fresh accepted rider reports update `Rider` and create `TrackingPoint` rows for the active delivery. GPS reports must be no older than 60 seconds, no more than 30 seconds in the future, and have reported accuracy within 500 metres. Out-of-order reports cannot overwrite a newer position.
- **Provenance:** migration `20261112000500_real_locations` marks existing tracking points `LEGACY`. It preserves their values but excludes them from live tracking responses. Only the GPS ingestion service explicitly marks new reports `GPS`. Legacy rider positions also remain hidden until the first new GPS report. Future development seeds create no GPS points.

## API changes

`POST /orders` and `POST /public/qr/:code/orders` now require:

```json
{
  "pickupLocation": {"latitude": 9.0765, "longitude": 7.3986},
  "deliveryLocation": {"latitude": 9.08, "longitude": 7.42}
}
```

These are **illustrative example coordinates**, never defaults injected into an order. Both coordinates must be within latitude ±90 and longitude ±180. Deploy server/client together and update any external booking clients to send confirmed points. Existing orders remain valid with null endpoints.

Staff can confirm missing points on active orders through the order drawer, backed by `PATCH /dispatch/orders/:id/locations` with the same two location objects. This does not rewrite addresses, status, assignments or history. Finished/cancelled orders cannot be changed through that endpoint. Unknown historical addresses are never geocoded automatically.

`POST /dispatch/rider/location` requires `{ latitude, longitude, accuracy, capturedAt }`; `accuracy` is metres and `capturedAt` is an ISO timestamp. Caller identity comes from authentication, not the body. The server locks/rechecks the rider before accepting the report. User-provided/device-reported coordinates are not independently certified physical-location evidence.

Tracking responses include confirmed `pickupLocation`, `deliveryLocation`, the latest accepted GPS fix and up to 200 recent GPS points in chronological `trail` order. Legacy data remains in the database but never enters this trail.

## Maps

Customer and rider maps display blue pickup pins, red destination pins and green GPS positions/trails. The trail connects recorded GPS samples; it is not a planned road route or an ETA. A **Follow updates** control fits incoming positions; it can be paused to inspect the map. Positions older than 60 seconds show stale rather than live. Fleet markers follow real reported rider coordinates and show stale/no-position states.

When no coordinates exist, a neutral world view has no rider/delivery marker and explicitly says it is waiting for location. It does not assume Berlin, Lagos or the device's IP location. OpenStreetMap supplies map tiles; it does not supply device tracking. Rider navigation opens the confirmed coordinate in [Google Maps directions](https://developers.google.com/maps/documentation/urls/get-started); route availability depends on the map provider. No paid geocoding/routing API or secret key is required by this implementation.

Socket.io invalidates tracking, fleet and rider queries after accepted reports; REST polling remains a fallback. Device reports pause with a hidden tab/offline state. This is foreground web tracking, not guaranteed background mobile tracking.

## Enable and verify

The earlier Phase 2 migration is still blocked by the three active assignments the user asked to preserve. Resolve those assignments first, then run `npm run phase2:recover` from server; it finishes that partial migration and deploys subsequent migrations, including location fields. Do not reset orders to enable maps. Restart server and client afterward.

For a new installation, `npm run db:deploy` applies the migrations normally. Production browser geolocation requires HTTPS and user permission ([browser API requirements](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/getCurrentPosition)). Use an approved rider account with permission enabled; create a booking with actual endpoint pins; claim/assign it; move with the rider page visible; verify fleet/customer markers update and the recorded trail grows. Denying permission must show a waiting/error state, never a simulated rider.

`node scripts/location-audit.mjs` is a read-only audit reporting counts of Berlin/Germany address text and relevant migration state. It never prints addresses, coordinates or credentials. It does not replace existing persisted addresses with the operator's location.

Automated API tests cover confirmed endpoint persistence, private staff location editing, exclusion of seeded Berlin coordinates, actual GPS trail order, active-delivery tracking while unavailable, stale/low-accuracy rejection, and out-of-order suppression. Existing assignments and historical data remain unchanged.
