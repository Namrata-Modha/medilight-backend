# MediLight Backend API

Express + Socket.io + MongoDB backend for the MediLight Dispensing System.

## Deploy to Render

1. Push this repo to GitHub
2. Go to render.com → New → Web Service → Connect this repo
3. Set environment variables:
   - `MONGO_URI` = your MongoDB Atlas connection string
   - `FRONTEND_URLS` = comma-separated Vercel URLs (dashboard + shelf device)
4. Deploy

## Local Development

```bash
npm install
MONGO_URI=mongodb://localhost:27017/medilight npm run dev
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/health | Health + device count |
| GET | /api/inventory | All products + low stock |
| POST | /api/ocr/extract | Parse prescription text |
| POST | /api/orders/validate | Validate manual selection |
| POST | /api/verify-id | Patient ID verification |
| POST | /api/orders/confirm | Confirm order + broadcast LEDs |
| POST | /api/leds/off | Turn off all LEDs |
| GET | /api/orders | Order history |
| POST | /api/inventory/reset | Reset test data |
