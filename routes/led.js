// routes/led.js — Manual LED trigger for ESP32 shelf devices

const { Router } = require("express");
const { broadcast } = require("../websocket");

const router = Router();

// POST /api/led/trigger — Broadcast any payload to connected devices
router.post("/trigger", (req, res) => {
  const sent = broadcast(req.body);
  res.json({ sent_to: sent, payload: req.body });
});

module.exports = router;
