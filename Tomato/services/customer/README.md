# Customer service

Owns customer business logic such as carts, delivery addresses, orders, and order history.

The current API gateway exposes this role at `GET /api/customer/overview`. Add customer controllers and models here as the domain grows. Requests must use a customer JWT.
