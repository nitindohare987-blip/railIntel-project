const express = require("express");
const cors = require("cors");

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Test route
app.get("/", (req, res) => {
    res.send("RailIntel Backend is Running 🚆");
});

// Start server
const PORT = 5000;

app.listen(PORT, () => {
    console.log(`RailIntel server running on http://localhost:${PORT}`);
});