const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();

// ================= MIDDLEWARE =================

app.use(cors());
app.use(express.json());


// ================= HOME ROUTE =================

app.get("/", (req, res) => {
    res.send("RailIntel Backend is Running 🚆");
});


// ================= API KEY TEST =================

app.get("/api/test", (req, res) => {

    if (process.env.RAILRADAR_API_KEY) {

        res.json({
            success: true,
            message: "RailRadar API key is connected!"
        });

    } else {

        res.status(500).json({
            success: false,
            message: "RailRadar API key not found!"
        });

    }

});


// ================= STATION SEARCH =================
// User can type city/station name.
// Backend gets suggestions from RailRadar.

app.get("/api/stations/search", async (req, res) => {

    try {

        const { q } = req.query;

        if (!q || q.trim().length < 2) {

            return res.json({
                success: true,
                data: {
                    stations: []
                }
            });

        }

        const url =
            `https://api.railradar.in/v1/lookup/search/stations?q=${encodeURIComponent(q.trim())}&limit=10`;

        const response = await fetch(url, {

            method: "GET",

            headers: {
                "Authorization":
                    `Bearer ${process.env.RAILRADAR_API_KEY}`,

                "Content-Type": "application/json"
            }

        });

        const data = await response.json();

        res.status(response.status).json(data);

    }

    catch (error) {

        console.error("Station Search Error:", error);

        res.status(500).json({

            success: false,

            message: "Unable to search stations.",

            error: error.message

        });

    }

});


// ================= TRAINS BETWEEN STATIONS =================

app.get("/api/trains", async (req, res) => {

    try {

        const { from, to } = req.query;

        if (!from || !to) {

            return res.status(400).json({

                success: false,

                message: "Please provide from and to station codes."

            });

        }

        const url =
            `https://api.railradar.in/v1/trains/between/${encodeURIComponent(from)}/${encodeURIComponent(to)}`;

        const response = await fetch(url, {

            method: "GET",

            headers: {

                "Authorization":
                    `Bearer ${process.env.RAILRADAR_API_KEY}`,

                "Content-Type": "application/json"

            }

        });

        const data = await response.json();

        res.status(response.status).json(data);

    }

    catch (error) {

        console.error("RailRadar API Error:", error);

        res.status(500).json({

            success: false,

            message: "Railway API request failed.",

            error: error.message

        });

    }

});
// ================= LIVE TRAIN STATUS =================

app.get("/api/running/:trainNumber", async (req, res) => {

    try {

        const { trainNumber } = req.params;

        if (!trainNumber) {
            return res.status(400).json({
                success: false,
                message: "Please provide train number."
            });
        }


        const url =
            `https://api.railradar.in/v1/trains/${encodeURIComponent(trainNumber)}/live?authoritative=true&haltsOnly=true`;


        const response = await fetch(url, {

            method: "GET",

            headers: {
                "Authorization":
                    `Bearer ${process.env.RAILRADAR_API_KEY}`,
                "Content-Type": "application/json"
            }

        });


        const data = await response.json();


        if (!response.ok) {

            return res.status(response.status).json(data);

        }


        // ================= TRAIN DATA =================

        const liveData = data?.data || {};

        const train =
            liveData?.train ||
            data?.train ||
            {};


        // ================= TODAY =================

        const today =
            new Intl.DateTimeFormat("en-US", {
                weekday: "short",
                timeZone: "Asia/Kolkata"
            })
            .format(new Date())
            .toLowerCase();


        // ================= RUN DAYS =================

        const runDays =
            train?.runDays ||
            liveData?.runDays ||
            data?.runDays ||
            [];


        console.log("Train:", trainNumber);

        console.log("Today:", today);

        console.log("Run Days:", runDays);


        // ================= TRAIN DOES NOT RUN TODAY =================

        if (
            Array.isArray(runDays) &&
            runDays.length > 0 &&
            !runDays.includes(today)
        ) {

            return res.json({

                success: false,

                notRunningToday: true,

                message:
                    `Train ${trainNumber} does not run today.`,

                train: {
                    number:
                        train?.number ||
                        trainNumber,

                    name:
                        train?.name ||
                        liveData?.trainName ||
                        "Train",

                    runDays: runDays

                }

            });

        }


        // ================= REAL LIVE DATA =================

        res.json(data);


    } catch (error) {

        console.error(
            "Live Train API Error:",
            error
        );


        res.status(500).json({

            success: false,

            message:
                "Railway live status request failed.",

            error: error.message

        });

    }

});
// ================= START SERVER =================

const PORT = 5000;

app.listen(PORT, () => {

    console.log(
        `RailIntel server running on http://localhost:${PORT}`
    );

});