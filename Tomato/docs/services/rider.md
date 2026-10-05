# Rider service

Owns delivery-partner business logic such as assigned deliveries, pickup and delivery status, routes, and earnings.

The current API gateway exposes this role at `GET /api/rider/overview`. Add rider controllers and models here as the domain grows. Requests must use a delivery-partner JWT.
