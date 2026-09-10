# Admin service

Owns platform administration such as user management, role approvals, restaurant and rider onboarding, reports, and audit operations.

The current API gateway exposes this role at `GET /api/admin/overview`. Add admin controllers and models here as the domain grows. Requests must use an admin JWT.
