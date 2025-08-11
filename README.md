# Ticket Booking Microservices (Bus & Train)

A microservice-based ticket booking system for bus and train with the following services:

- API Gateway (port 8080)
- Auth Service (port 3001)
- User Service (port 3002)
- Catalog Service (port 3003)
- Booking Service (port 3004)
- Payment Service (port 3005)
- Notification Service (port 3006)

## Quick start (local)

Node.js 18+ is recommended (tested on Node 22). From the repo root:

```bash
# Start all services (background) and write logs under /workspace/*.log
(cd services/user-service && node src/index.js > ../../user-service.log 2>&1 &) \
&& (cd services/catalog-service && node src/index.js > ../../catalog-service.log 2>&1 &) \
&& (cd services/payment-service && node src/index.js > ../../payment-service.log 2>&1 &) \
&& (cd services/notification-service && node src/index.js > ../../notification-service.log 2>&1 &) \
&& (cd services/auth-service && node src/index.js > ../../auth-service.log 2>&1 &) \
&& (cd services/booking-service && node src/index.js > ../../booking-service.log 2>&1 &) \
&& (cd services/api-gateway && PORT=8080 \
    AUTH_SERVICE_URL=http://localhost:3001 \
    USER_SERVICE_URL=http://localhost:3002 \
    CATALOG_SERVICE_URL=http://localhost:3003 \
    BOOKING_SERVICE_URL=http://localhost:3004 \
    PAYMENT_SERVICE_URL=http://localhost:3005 \
    NOTIFICATION_SERVICE_URL=http://localhost:3006 \
    node src/index.js > ../../api-gateway.log 2>&1 &)
```

Health checks:

```bash
curl -s http://localhost:8080/health    # API Gateway
curl -s http://localhost:3001/health    # Auth
curl -s http://localhost:3002/health    # User
curl -s http://localhost:3003/health    # Catalog
curl -s http://localhost:3004/health    # Booking
curl -s http://localhost:3005/health    # Payment
curl -s http://localhost:3006/health    # Notification
```

## Docker (optional)

If you have Docker installed:

```bash
# Build and run
docker compose build
docker compose up -d

# Gateway will be on http://localhost:8080
```

## Features

- JWT authentication (register/login)
- User profiles (get/update)
- Catalog search for trips (bus or train)
- Seat inventory and reservation with conflict handling
- Booking lifecycle: hold -> confirm (charge) -> cancel/refund
- Mock payments and notification hooks
- API Gateway with rate limiting, CORS, and security headers

## Data storage

Each service persists to its own local SQLite database using better-sqlite3:
- Auth: `auth.db`
- User: `users.db`
- Catalog: `catalog.db` (auto-seeded with sample trips)
- Booking: `booking.db`

## Example flow (via API Gateway)

1) Register and get a token
```bash
TOKEN=$(curl -s -X POST http://localhost:8080/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"user@example.com","password":"secret123"}' | jq -r .token)
```

2) Search trips
```bash
curl -s 'http://localhost:8080/catalog/search?origin=CityA&destination=CityB'
```

3) View seats for a trip (e.g., t_bus_1)
```bash
curl -s http://localhost:8080/catalog/trips/t_bus_1/seats
```

4) Hold seats (requires auth)
```bash
BOOKING_ID=$(curl -s -X POST http://localhost:8080/booking/hold \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"tripId":"t_bus_1","seatNumbers":["1","2"],"amountCents":5000}' | jq -r .bookingId)
```

5) Confirm booking (charges payment)
```bash
curl -s -X POST http://localhost:8080/booking/$BOOKING_ID/confirm \
  -H "Authorization: Bearer $TOKEN"
```

6) Get booking details
```bash
curl -s http://localhost:8080/booking/$BOOKING_ID \
  -H "Authorization: Bearer $TOKEN"
```

7) Cancel and refund (if confirmed)
```bash
curl -X POST http://localhost:8080/booking/$BOOKING_ID/cancel \
  -H "Authorization: Bearer $TOKEN"
```

8) Profile endpoints
```bash
curl -s http://localhost:8080/users/me -H "Authorization: Bearer $TOKEN"

curl -s -X PATCH http://localhost:8080/users/me \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"full_name":"Ada Lovelace","phone":"+1234567"}'
```

## Service ports and routes

- API Gateway: http://localhost:8080
  - Public: `/auth/*`, `/catalog/*`
  - Protected: `/users/*`, `/booking/*`, `/payments/*`, `/notifications/*`

- Auth: `POST /register`, `POST /login`
- User: `POST /profiles` (internal), `GET /me`, `PATCH /me`
- Catalog: `GET /search`, `GET /trips/:id`, `GET /trips/:id/seats`, `POST /trips` (admin)
  - Internal: `POST /internal/trips/:id/reserve`, `POST /internal/trips/:id/release`
- Booking: `POST /hold`, `POST /:id/confirm`, `POST /:id/cancel`, `GET /:id`
- Payment: `POST /charge`, `POST /refund`
- Notification: `POST /notify`

## Notes

- The payment service is a mock and randomly declines ~10% of charges.
- Seat reservation updates are transactional and prevent double booking.
- JWT secret defaults to `supersecretjwt` for local use; set `JWT_SECRET` in production.