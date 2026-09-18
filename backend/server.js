const express = require("express");
const cors = require("cors");
const cron = require("node-cron");

const connectDB = require("./db");
const DelayHistory = require("./models/DelayHistory");

require("dotenv").config();

const app = express();


// ======================================================
// ===================== MIDDLEWARE =====================
// ======================================================

app.use(cors());
app.use(express.json());


// ======================================================
// ===================== CONFIG =========================
// ======================================================

const PORT = 5000;

const API_KEY = process.env.RAILRADAR_API_KEY;

// Trains whose reliability data we want to collect
// Later we can make this dynamic from MongoDB.
const TRACKED_TRAINS = (
    process.env.TRACKED_TRAINS || "12919"
)
    .split(",")
    .map(train => train.trim())
    .filter(Boolean);


// ======================================================
// ===================== RAILRADAR =======================
// ======================================================

async function getLiveTrain(trainNumber) {

    const url =
        `https://api.railradar.in/v1/trains/${encodeURIComponent(
            trainNumber
        )}/live?authoritative=true&haltsOnly=true`;

    const response = await fetch(url, {

        method: "GET",

        headers: {
            "Authorization": `Bearer ${API_KEY}`,
            "Content-Type": "application/json"
        }

    });

    const data = await response.json();

    if (!response.ok) {

        const error = new Error(
            data?.error?.message ||
            "RailRadar API request failed."
        );

        error.status = response.status;

        throw error;
    }

    return data;
}


// ======================================================
// ===================== HOME ===========================
// ======================================================

app.get("/", (req, res) => {

    res.send("RailIntel Backend is Running 🚆");

});


// ======================================================
// ===================== API TEST =======================
// ======================================================

app.get("/api/test", (req, res) => {

    if (API_KEY) {

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


// ======================================================
// ================= STATION SEARCH =====================
// ======================================================

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
            `https://api.railradar.in/v1/lookup/search/stations?q=${encodeURIComponent(
                q.trim()
            )}&limit=10`;

        const response = await fetch(url, {

            headers: {
                "Authorization": `Bearer ${API_KEY}`,
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


// ======================================================
// ============== TRAINS BETWEEN STATIONS ==============
// ======================================================

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
            `https://api.railradar.in/v1/trains/between/${encodeURIComponent(
                from
            )}/${encodeURIComponent(to)}`;

        const response = await fetch(url, {

            headers: {
                "Authorization": `Bearer ${API_KEY}`,
                "Content-Type": "application/json"
            }

        });

        const data = await response.json();

        res.status(response.status).json(data);

    }

    catch (error) {

        console.error("Train Search Error:", error);

        res.status(500).json({
            success: false,
            message: "Railway API request failed.",
            error: error.message
        });

    }

});


// ======================================================
// ================= LIVE TRAIN STATUS ==================
// ======================================================

app.get("/api/running/:trainNumber", async (req, res) => {

    try {

        const { trainNumber } = req.params;

        if (!trainNumber) {

            return res.status(400).json({
                success: false,
                message: "Please provide train number."
            });

        }

        const data = await getLiveTrain(trainNumber);

        const liveData = data?.data || {};

        const train =
            liveData?.train ||
            data?.train ||
            {};

        const today =
            new Intl.DateTimeFormat(
                "en-US",
                {
                    weekday: "short",
                    timeZone: "Asia/Kolkata"
                }
            )
                .format(new Date())
                .toLowerCase();

        const runDays =
            train?.runDays ||
            liveData?.runDays ||
            data?.runDays ||
            [];

        // Train does not run today
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

                    runDays

                }

            });

        }

        res.json(data);

    }

    catch (error) {

        console.error("Live Train API Error:", error);

        res.status(error.status || 500).json({

            success: false,

            message:
                "Railway live status request failed.",

            error:
                error.message

        });

    }

});


// ======================================================
// ======================== PNR ==========================
// ======================================================

app.get("/api/pnr/:pnr", async (req, res) => {

    try {

        const { pnr } = req.params;

        if (!pnr || !/^\d{10}$/.test(pnr)) {

            return res.status(400).json({

                success: false,

                message:
                    "Please provide a valid 10-digit PNR number."

            });

        }

        const url =
            `https://api.railradar.in/v1/pnr/${encodeURIComponent(pnr)}`;

        const response = await fetch(url, {

            headers: {

                "Authorization":
                    `Bearer ${API_KEY}`,

                "Content-Type":
                    "application/json"

            }

        });

        const data = await response.json();

        res.status(response.status).json(data);

    }

    catch (error) {

        console.error("PNR API Error:", error);

        res.status(500).json({

            success: false,

            message:
                "Railway PNR request failed.",

            error:
                error.message

        });

    }

});


// ======================================================
// ============ COLLECT ONE TRAIN SNAPSHOT ==============
// ======================================================

async function collectTrainDelay(trainNumber) {

    const data = await getLiveTrain(trainNumber);

    const liveData = data?.data || {};

    const train =
        liveData?.train || {};

    const realTrainNumber =
        train?.number ||
        liveData?.trainNumber ||
        trainNumber;

    const trainName =
        train?.name ||
        liveData?.trainName ||
        "Unknown Train";

    const delayMinutes =
        Number(
            liveData?.delayMinutes || 0
        );

    const status =
        liveData?.status ||
        "unknown";

    const currentStation =
        liveData
            ?.currentLocation
            ?.stationCode ||
        "-";

    const nextStation =
        liveData
            ?.nextHalt
            ?.stationName ||
        "-";


    // ==============================================
    // JOURNEY DATE
    // ==============================================

    const journeyDate =
        liveData?.startDate ||
        new Intl.DateTimeFormat(
            "en-CA",
            {
                timeZone:
                    "Asia/Kolkata"
            }
        ).format(new Date());


    // ==============================================
    // DAY OF WEEK
    // ==============================================

    const dayOfWeek =
        new Intl.DateTimeFormat(
            "en-US",
            {
                weekday: "long",
                timeZone:
                    "Asia/Kolkata"
            }
        ).format(new Date());


    // ==============================================
    // UPDATE EXISTING JOURNEY
    // ==============================================

    const existingRecord =
        await DelayHistory.findOne({

            trainNumber:
                realTrainNumber,

            journeyDate:
                journeyDate

        });


    let savedRecord;


    if (existingRecord) {

        existingRecord.trainName =
            trainName;

        existingRecord.delayMinutes =
            delayMinutes;

        existingRecord.status =
            status;

        existingRecord.currentStation =
            currentStation;

        existingRecord.nextStation =
            nextStation;

        existingRecord.dayOfWeek =
            dayOfWeek;

        existingRecord.capturedAt =
            new Date();

        savedRecord =
            await existingRecord.save();

    }


    // ==============================================
    // CREATE NEW JOURNEY
    // ==============================================

    else {

        savedRecord =
            await DelayHistory.create({

                trainNumber:
                    realTrainNumber,

                trainName:
                    trainName,

                journeyDate:
                    journeyDate,

                delayMinutes:
                    delayMinutes,

                status:
                    status,

                currentStation:
                    currentStation,

                nextStation:
                    nextStation,

                capturedAt:
                    new Date(),

                dayOfWeek:
                    dayOfWeek

            });

    }


    return savedRecord;

}


// ======================================================
// ============== MANUAL COLLECTION API ================
// ======================================================

app.get(
    "/api/reliability/collect/:trainNumber",
    async (req, res) => {

        try {

            const { trainNumber } =
                req.params;

            if (!trainNumber) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Please provide train number."

                });

            }

            const savedRecord =
                await collectTrainDelay(
                    trainNumber
                );

            res.json({

                success: true,

                message:
                    "Real train delay snapshot saved successfully.",

                data:
                    savedRecord

            });

        }

        catch (error) {

            console.error(
                "Delay Collection Error:",
                error
            );

            res.status(
                error.status || 500
            ).json({

                success: false,

                message:
                    "Unable to save train delay history.",

                error:
                    error.message

            });

        }

    }
);


// ======================================================
// ================= GET DELAY HISTORY ==================
// ======================================================

app.get(
    "/api/reliability/history/:trainNumber",
    async (req, res) => {

        try {

            const { trainNumber } =
                req.params;

            if (!trainNumber) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Please provide train number."

                });

            }

            const history =
                await DelayHistory.find({

                    trainNumber:
                        trainNumber

                })
                    .sort({
                        journeyDate: -1
                    })
                    .limit(90);


            res.json({

                success: true,

                trainNumber:
                    trainNumber,

                totalRecords:
                    history.length,

                data:
                    history

            });

        }

        catch (error) {

            console.error(
                "Delay History Error:",
                error
            );

            res.status(500).json({

                success: false,

                message:
                    "Unable to fetch delay history.",

                error:
                    error.message

            });

        }

    }
);


// ======================================================
// ================ RELIABILITY ANALYZER ===============
// ======================================================

app.get(
    "/api/reliability/:trainNumber",
    async (req, res) => {

        try {

            const { trainNumber } =
                req.params;

            if (!trainNumber) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Please provide train number."

                });

            }


            // ==========================================
            // GET CURRENT LIVE DATA
            // ==========================================

            const liveResponse =
                await getLiveTrain(
                    trainNumber
                );

            const liveData =
                liveResponse?.data || {};

            const train =
                liveData?.train || {};

            const currentDelay =
                Number(
                    liveData?.delayMinutes || 0
                );


            // ==========================================
            // SAVE TODAY'S DATA
            // ==========================================

            await collectTrainDelay(
                trainNumber
            );


            // ==========================================
            // GET HISTORY
            // ==========================================

            const history =
                await DelayHistory.find({

                    trainNumber:
                        trainNumber

                })
                    .sort({
                        journeyDate: -1
                    })
                    .limit(90);


            // ==========================================
            // NOT ENOUGH DATA
            // ==========================================

            if (history.length < 2) {

                return res.json({

                    success: true,

                    data: {

                        trainNumber:
                            train?.number ||
                            trainNumber,

                        trainName:
                            train?.name ||
                            liveData?.trainName ||
                            "Train",

                        historicalDataAvailable:
                            false,

                        totalRecords:
                            history.length,

                        message:
                            "Not enough historical data yet. Keep collecting real train data.",

                        reliabilityScore:
                            null,

                        reliabilityStatus:
                            "Insufficient Data",

                        currentDelay:
                            currentDelay,

                        currentStation:
                            liveData
                                ?.currentLocation
                                ?.stationCode ||
                            "-",

                        nextStation:
                            liveData
                                ?.nextHalt
                                ?.stationName ||
                            "-"

                    }

                });

            }


            // ==========================================
            // DELAY ARRAY
            // ==========================================

            const delays =
                history.map(record =>
                    Number(
                        record.delayMinutes || 0
                    )
                );


            // ==========================================
            // AVERAGE DELAY
            // ==========================================

            const averageDelay =
                delays.reduce(
                    (sum, value) =>
                        sum + value,
                    0
                ) / delays.length;


            // ==========================================
            // MEDIAN DELAY
            // ==========================================

            const sortedDelays =
                [...delays].sort(
                    (a, b) => a - b
                );

            const middle =
                Math.floor(
                    sortedDelays.length / 2
                );

            const medianDelay =
                sortedDelays.length % 2 === 0

                    ? (
                        sortedDelays[middle - 1] +
                        sortedDelays[middle]
                    ) / 2

                    : sortedDelays[middle];


            // ==========================================
            // LOW DELAY DAYS
            // <= 15 MINUTES
            // ==========================================

            const lowDelayDays =
                delays.filter(
                    delay => delay <= 15
                ).length;

            const lowDelayPercentage =
                (
                    lowDelayDays /
                    delays.length
                ) * 100;


            // ==========================================
            // MAJOR DELAY DAYS
            // > 60 MINUTES
            // ==========================================

            const majorDelayDays =
                delays.filter(
                    delay => delay > 60
                ).length;

            const majorDelayPercentage =
                (
                    majorDelayDays /
                    delays.length
                ) * 100;


            // ==========================================
            // DAY-WISE PATTERN
            // ==========================================

            const dayGroups = {};

            history.forEach(record => {

                const day =
                    record.dayOfWeek ||
                    "Unknown";

                if (!dayGroups[day]) {

                    dayGroups[day] = [];

                }

                dayGroups[day].push(
                    Number(
                        record.delayMinutes || 0
                    )
                );

            });


            const dayWisePattern = {};

            Object.keys(dayGroups).forEach(
                day => {

                    const values =
                        dayGroups[day];

                    const avg =
                        values.reduce(
                            (sum, value) =>
                                sum + value,
                            0
                        ) / values.length;

                    dayWisePattern[day] =
                        Number(
                            avg.toFixed(1)
                        );

                }
            );


            // ==========================================
            // RAILINTEL RELIABILITY INDICATOR
            // ==========================================
            // This is our calculated indicator.
            // It is NOT an official railway rating.

            let score = 100;


            // Average delay effect

            if (averageDelay <= 5) {

                score -= 0;

            }

            else if (averageDelay <= 15) {

                score -= 10;

            }

            else if (averageDelay <= 30) {

                score -= 20;

            }

            else if (averageDelay <= 60) {

                score -= 35;

            }

            else {

                score -= 50;

            }


            // Low delay consistency

            if (lowDelayPercentage >= 80) {

                score += 0;

            }

            else if (lowDelayPercentage >= 60) {

                score -= 5;

            }

            else if (lowDelayPercentage >= 40) {

                score -= 10;

            }

            else {

                score -= 15;

            }


            // Major delays

            if (majorDelayPercentage >= 30) {

                score -= 15;

            }

            else if (majorDelayPercentage >= 15) {

                score -= 10;

            }

            else if (majorDelayPercentage >= 5) {

                score -= 5;

            }


            score =
                Math.max(
                    0,
                    Math.min(100, Math.round(score))
                );


            // ==========================================
            // RELIABILITY STATUS
            // ==========================================

            let reliabilityStatus;

            if (score >= 85) {

                reliabilityStatus =
                    "Very Reliable";

            }

            else if (score >= 70) {

                reliabilityStatus =
                    "Reliable";

            }

            else if (score >= 50) {

                reliabilityStatus =
                    "Average";

            }

            else {

                reliabilityStatus =
                    "Needs Caution";

            }


            // ==========================================
            // CURRENT VS HISTORICAL
            // ==========================================

            let currentComparison =
                "Currently close to its historical average.";

            if (
                currentDelay >
                averageDelay + 15
            ) {

                currentComparison =
                    "Currently worse than its recent average.";

            }

            else if (
                currentDelay <
                averageDelay - 15
            ) {

                currentComparison =
                    "Currently better than its recent average.";

            }


            // ==========================================
            // FINAL RESPONSE
            // ==========================================

            res.json({

                success: true,

                data: {

                    trainNumber:
                        train?.number ||
                        trainNumber,

                    trainName:
                        train?.name ||
                        liveData?.trainName ||
                        "Train",


                    historicalDataAvailable:
                        true,

                    totalRecords:
                        history.length,


                    reliabilityScore:
                        score,

                    reliabilityStatus:
                        reliabilityStatus,


                    averageDelay:
                        Number(
                            averageDelay.toFixed(1)
                        ),

                    medianDelay:
                        Number(
                            medianDelay.toFixed(1)
                        ),


                    lowDelayDays:
                        lowDelayDays,

                    lowDelayPercentage:
                        Number(
                            lowDelayPercentage.toFixed(1)
                        ),


                    majorDelayDays:
                        majorDelayDays,

                    majorDelayPercentage:
                        Number(
                            majorDelayPercentage.toFixed(1)
                        ),


                    dayWisePattern:
                        dayWisePattern,


                    currentDelay:
                        currentDelay,

                    currentComparison:
                        currentComparison,


                    currentStation:
                        liveData
                            ?.currentLocation
                            ?.stationCode ||
                        "-",

                    nextStation:
                        liveData
                            ?.nextHalt
                            ?.stationName ||
                        "-"

                }

            });

        }

        catch (error) {

            console.error(
                "Reliability API Error:",
                error
            );

            res.status(
                error.status || 500
            ).json({

                success: false,

                message:
                    "Reliability analysis failed.",

                error:
                    error.message

            });

        }

    }
);


// ======================================================
// =============== AUTOMATIC DATA COLLECTOR =============
// ======================================================

// Runs every 12 hours.
//
// Example:
// 12919
//     ↓
// RailRadar Live API
//     ↓
// MongoDB
//
// This slowly builds real historical data.

cron.schedule(
    "0 */12 * * *",
    async () => {

        console.log(
            "\n======================================"
        );

        console.log(
            "🚆 RailIntel Automatic Collector"
        );

        console.log(
            "Time:",
            new Date().toLocaleString(
                "en-IN",
                {
                    timeZone:
                        "Asia/Kolkata"
                }
            )
        );

        console.log(
            "======================================"
        );


        for (
            const trainNumber
            of TRACKED_TRAINS
        ) {

            try {

                console.log(
                    `Collecting ${trainNumber}...`
                );

                const record =
                    await collectTrainDelay(
                        trainNumber
                    );

                console.log(
                    `✅ ${trainNumber} saved | Delay: ${record.delayMinutes} min`
                );

            }

            catch (error) {

                console.error(
                    `❌ ${trainNumber} failed:`,
                    error.message
                );

            }

        }

    },
    {
        timezone:
            "Asia/Kolkata"
    }
);


// ======================================================
// ===================== START SERVER ===================
// ======================================================

async function startServer() {

    try {

        await connectDB();

        app.listen(
            PORT,
            () => {

                console.log(
                    `\n🚆 RailIntel server running on http://localhost:${PORT}`
                );

                console.log(
                    `📊 Tracking trains: ${TRACKED_TRAINS.join(", ")}`
                );

                console.log(
                    "⏰ Automatic collection: Every 12 hours"
                );

            }
        );

    }

    catch (error) {

        console.error(
            "Server startup failed:",
            error.message
        );

    }

}

startServer();