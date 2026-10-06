const express = require("express");
const cors = require("cors");
const cron = require("node-cron");

const connectDB = require("./db");
const DelayHistory = require("./models/DelayHistory");
const Rating = require("./models/Rating");
const User = require("./models/User");
const bcrypt = require("bcryptjs");
require("dotenv").config();

const app = express();


// ======================================================
// MIDDLEWARE
// ======================================================

app.use(cors());
app.use(express.json());


// ======================================================
// CONFIG
// ======================================================

const PORT = process.env.PORT || 5000;

const API_KEY = process.env.RAILRADAR_API_KEY;

const TRACKED_TRAINS = (
    process.env.TRACKED_TRAINS || "12919"
)
    .split(",")
    .map(train => train.trim())
    .filter(Boolean);


// ======================================================
// RAILRADAR - LIVE TRAIN
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
// HOME
// ======================================================

app.get("/", (req, res) => {

    res.send("RailIntel Backend is Running 🚆");

});


// ======================================================
// API TEST
// ======================================================

app.get("/api/test", (req, res) => {

    if (!API_KEY) {

        return res.status(500).json({
            success: false,
            message: "RailRadar API key not found!"
        });

    }

    res.json({
        success: true,
        message: "RailRadar API key is connected!"
    });

});


// ======================================================
// STATION SEARCH
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

        console.error(
            "Station Search Error:",
            error.message
        );

        res.status(500).json({

            success: false,

            message:
                "Unable to search stations.",

            error:
                error.message

        });

    }

});


// ======================================================
// TRAINS BETWEEN STATIONS
// ======================================================
// ======================================================
// ============ TRAINS BETWEEN STATIONS =================
// ======================================================

app.get("/api/trains", async (req, res) => {

    try {

        const { from, to, date } = req.query;


        // Check source and destination
        if (!from || !to) {

            return res.status(400).json({
                success: false,
                message: "Please provide from and to station codes."
            });

        }


        // Check date format if date is provided
        if (date) {

            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

            if (!dateRegex.test(date)) {

                return res.status(400).json({
                    success: false,
                    message: "Date must be in YYYY-MM-DD format."
                });

            }

        }


        // RailRadar trains-between API
        let url =
            `https://api.railradar.in/v1/trains/between/${encodeURIComponent(from)}/${encodeURIComponent(to)}`;


        // Add selected journey date
        if (date) {

            url += `?date=${encodeURIComponent(date)}`;

        }


        console.log(
            `🚆 Searching trains: ${from} → ${to}` +
            (date ? ` | Date: ${date}` : "")
        );


        // Call RailRadar API
        const response = await fetch(url, {

            method: "GET",

            headers: {

                "Authorization": `Bearer ${API_KEY}`,

                "Content-Type": "application/json"

            }

        });


        const data = await response.json();


        // RailRadar error
        if (!response.ok) {

            console.error(
                "Train Search API Error:",
                data
            );

            return res.status(response.status).json({

                success: false,

                message:
                    data?.error?.message ||
                    "Unable to fetch trains.",

                error:
                    data?.error || null

            });

        }


        // Send RailRadar response to frontend
        res.status(200).json(data);


    } catch (error) {

        console.error(
            "Train Search Error:",
            error.message
        );


        res.status(500).json({

            success: false,

            message: "Unable to search trains.",

            error: error.message

        });

    }

});
// ======================================================
// ============ REAL SEAT AVAILABILITY ==================
// ======================================================

app.get("/api/seat-availability", async (req, res) => {

    try {

        const {
            trainNumber,
            source,
            destination,
            journeyDate,
            classCode
        } = req.query;


        // ================= VALIDATION =================

        if (
            !trainNumber ||
            !source ||
            !destination ||
            !journeyDate ||
            !classCode
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "trainNumber, source, destination, journeyDate and classCode are required."

            });

        }


        // ================= ALLOWED CLASSES =================

        const allowedClasses = [
            "1A",
            "2A",
            "3A",
            "3E",
            "CC",
            "EC",
            "EA",
            "FC",
            "SL",
            "2S"
        ];


        if (!allowedClasses.includes(classCode)) {

            return res.status(400).json({

                success: false,

                message:
                    "Invalid class code."

            });

        }


        // ================= RAILRADAR API =================

        const url =
            `https://api.railradar.in/v1/trains/${encodeURIComponent(trainNumber)}/seats` +
            `?journeyDate=${encodeURIComponent(journeyDate)}` +
            `&source=${encodeURIComponent(source)}` +
            `&destination=${encodeURIComponent(destination)}` +
            `&classCode=${encodeURIComponent(classCode)}` +
            `&quotaCode=GN`;


        console.log(
            `💺 Checking ${trainNumber} ${classCode} | ${source} → ${destination} | ${journeyDate}`
        );


        const response = await fetch(url, {

            method: "GET",

            headers: {

                "Authorization":
                    `Bearer ${API_KEY}`,

                "Content-Type":
                    "application/json"

            }

        });


        const data =
            await response.json();


        // ================= API ERROR =================

        if (!response.ok) {

            console.error(
                "Seat Availability API Error:",
                data
            );


            return res.status(
                response.status
            ).json({

                success: false,

                message:
                    data?.error?.message ||
                    "Unable to fetch seat availability.",

                error:
                    data?.error || null

            });

        }


        // ================= FIND SELECTED DATE =================

        const availabilityList =
            data?.data?.avlDayList || [];


        const selectedDay =
            availabilityList.find(
                item =>
                    item.availablityDate ===
                    journeyDate
            );


        // ================= RESPONSE =================

        res.json({

            success: true,

            trainNumber:
                trainNumber,

            source:
                source,

            destination:
                destination,

            journeyDate:
                journeyDate,

            classCode:
                classCode,

            quotaCode:
                data?.data?.quotaCode ||
                "GN",

            availability:
                selectedDay?.availablityStatus ||
                "N/A",

            data:
                data?.data || null

        });

    }


    catch (error) {

        console.error(
            "Seat Availability Error:",
            error.message
        );


        res.status(500).json({

            success: false,

            message:
                "Unable to fetch seat availability.",

            error:
                error.message

        });

    }

});
// ======================================================
// RUNNING STATUS
// ======================================================

app.get("/api/running/:trainNumber", async (req, res) => {

    try {

        const { trainNumber } = req.params;

        if (!trainNumber) {

            return res.status(400).json({

                success: false,

                message:
                    "Please provide train number."

            });

        }

        const data =
            await getLiveTrain(trainNumber);

        const liveData =
            data?.data || {};

        const train =
            liveData?.train ||
            {};

        // Current day in India

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

                    runDays:
                        runDays

                }

            });

        }

        res.json(data);

    }

    catch (error) {

        console.error(
            "Live Train Error:",
            error.message
        );

        res.status(
            error.status || 500
        ).json({

            success: false,

            message:
                "Railway live status request failed.",

            error:
                error.message

        });

    }

});
// ======================================================
// ===================== SIGNUP ==========================
// ======================================================

app.post("/api/signup", async (req, res) => {

    try {

        const {
            name,
            email,
            password
        } = req.body;


        // Validation
        if (!name || !email || !password) {

            return res.status(400).json({

                success: false,

                message:
                    "Name, email and password are required."

            });

        }


        if (password.length < 6) {

            return res.status(400).json({

                success: false,

                message:
                    "Password must be at least 6 characters."

            });

        }


        const normalizedEmail =
            email.trim().toLowerCase();


        // Check existing user
        const existingUser =
            await User.findOne({
                email: normalizedEmail
            });


        if (existingUser) {

            return res.status(409).json({

                success: false,

                message:
                    "Email is already registered."

            });

        }


        // Hash password
        const hashedPassword =
            await bcrypt.hash(password, 10);


        // Create user
        const user =
            await User.create({

                name:
                    name.trim(),

                email:
                    normalizedEmail,

                password:
                    hashedPassword

            });


        res.status(201).json({

            success: true,

            message:
                "Account created successfully.",

            user: {

                id:
                    user._id,

                name:
                    user.name,

                email:
                    user.email

            }

        });

    }

    catch (error) {

        console.error(
            "Signup Error:",
            error
        );


        res.status(500).json({

            success: false,

            message:
                "Unable to create account.",

            error:
                error.message

        });

    }

});
// ======================================================
// ====================== LOGIN ==========================
// ======================================================

app.post("/api/login", async (req, res) => {

    try {

        const {
            email,
            password
        } = req.body;


        if (!email || !password) {

            return res.status(400).json({

                success: false,

                message:
                    "Email and password are required."

            });

        }


        const normalizedEmail =
            email.trim().toLowerCase();


        // Find user
        const user =
            await User.findOne({
                email: normalizedEmail
            });


        if (!user) {

            return res.status(401).json({

                success: false,

                message:
                    "Invalid email or password."

            });

        }


        // Compare password
        const passwordMatch =
            await bcrypt.compare(
                password,
                user.password
            );


        if (!passwordMatch) {

            return res.status(401).json({

                success: false,

                message:
                    "Invalid email or password."

            });

        }


        res.json({

            success: true,

            message:
                "Login successful.",

            user: {

                id:
                    user._id,

                name:
                    user.name,

                email:
                    user.email

            }

        });

    }

    catch (error) {

        console.error(
            "Login Error:",
            error
        );


        res.status(500).json({

            success: false,

            message:
                "Unable to login.",

            error:
                error.message

        });

    }

});
// ======================================================
// ============ ALTERNATIVE ROUTES =======================
// ======================================================

const ALTERNATIVE_HUBS = [
    {
        code: "BPL",
        name: "Bhopal Junction"
    },
    {
        code: "UJN",
        name: "Ujjain Junction"
    },
    {
        code: "JHS",
        name: "Jhansi Junction"
    },
    {
        code: "AGC",
        name: "Agra Cantt"
    },
    {
        code: "KOTA",
        name: "Kota Junction"
    }
];


// ------------------------------------------------------
// GET REAL TRAINS BETWEEN TWO STATIONS
// ------------------------------------------------------

async function getTrainsBetween(
    from,
    to
) {

    const url =
        `https://api.railradar.in/v1/trains/between/` +
        `${encodeURIComponent(from)}/` +
        `${encodeURIComponent(to)}`;

    const response =
        await fetch(url, {
            method: "GET",
            headers: {
                "Authorization":
                    `Bearer ${API_KEY}`,

                "Content-Type":
                    "application/json"
            }
        });

    const data =
        await response.json();

    if (!response.ok) {

        throw new Error(
            data?.error?.message ||
            "RailRadar train search failed."
        );
    }

    return data;
}


// ------------------------------------------------------
// ALTERNATIVE ROUTE API
// ------------------------------------------------------

app.get(
    "/api/alternative-routes",
    async (req, res) => {

        try {

            const from =
                (req.query.from || "")
                    .trim()
                    .toUpperCase();

            const to =
                (req.query.to || "")
                    .trim()
                    .toUpperCase();


            if (!from || !to) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Please provide from and to station codes."
                });
            }


            if (from === to) {

                return res.status(400).json({
                    success: false,
                    message:
                        "From and To stations cannot be same."
                });
            }


            console.log(
                `🔎 Finding alternative route: ${from} → ${to}`
            );


            // ==================================================
            // 1. CHECK DIRECT TRAINS
            // ==================================================

            let directData = null;

            try {

                directData =
                    await getTrainsBetween(
                        from,
                        to
                    );

            }
            catch (error) {

                console.log(
                    "Direct train search failed:",
                    error.message
                );

            }


            const directTrains =
                directData?.data?.trains ||
                [];


            //// ======================================================
// ============ SMART ALTERNATIVE ROUTES =================
// ======================================================

/*
    Route-aware interchange stations.

    Idea:
    Gwalior -> Amritsar
    should prefer:
    GWL -> Delhi -> Amritsar

    Gwalior -> Indore
    can prefer:
    GWL -> Bhopal -> Indore
    or
    GWL -> Ujjain -> Indore

    We do NOT blindly suggest every hub.
*/

const ROUTE_HUBS = [

    // North / Delhi side
    {
        code: "NDLS",
        name: "New Delhi",
        regions: ["north", "delhi", "punjab", "haryana"]
    },

    {
        code: "AGC",
        name: "Agra Cantt",
        regions: ["north", "delhi", "punjab"]
    },

    // Central / MP side
    {
        code: "BPL",
        name: "Bhopal Junction",
        regions: ["central", "mp", "west"]
    },

    {
        code: "UJN",
        name: "Ujjain Junction",
        regions: ["mp", "west", "central"]
    },

    // Rajasthan / West
    {
        code: "KOTA",
        name: "Kota Junction",
        regions: ["north", "west", "rajasthan"]
    },

    // Maharashtra side
    {
        code: "NGP",
        name: "Nagpur Junction",
        regions: ["central", "east", "south"]
    },

    // East
    {
        code: "ALD",
        name: "Prayagraj",
        regions: ["east", "north", "central"]
    }

];


// ======================================================
// ROUTE PREFERENCE MAP
// ======================================================

const ROUTE_PREFERENCES = [

    // Gwalior -> Amritsar / Punjab
    {
        from: ["GWL"],
        to: [
            "ASR",
            "LDH",
            "JUC",
            "PTK"
        ],
        preferred: [
            "NDLS",
            "AGC"
        ]
    },

    // Gwalior -> Delhi
    {
        from: ["GWL"],
        to: [
            "NDLS",
            "DLI",
            "ANVT",
            "NZM"
        ],
        preferred: [
            "AGC"
        ]
    },

    // Gwalior -> Indore / MP
    {
        from: ["GWL"],
        to: [
            "INDB",
            "UJN",
            "BPL"
        ],
        preferred: [
            "BPL",
            "UJN"
        ]
    },

    // Gwalior -> Mumbai / Maharashtra
    {
        from: ["GWL"],
        to: [
            "CSMT",
            "LTT",
            "BDTS",
            "MMCT"
        ],
        preferred: [
            "BPL",
            "KOTA"
        ]
    },

    // Gwalior -> Rajasthan
    {
        from: ["GWL"],
        to: [
            "JP",
            "AII",
            "JU",
            "UDZ"
        ],
        preferred: [
            "KOTA",
            "AGC"
        ]
    },

    // Gwalior -> East
    {
        from: ["GWL"],
        to: [
            "HWH",
            "KOAA",
            "BBS",
            "RNC"
        ],
        preferred: [
            "ALD",
            "NGP"
        ]
    }

];


// ======================================================
// FIND PREFERRED HUBS
// ======================================================

function getPreferredHubs(from, to) {

    const preference =
        ROUTE_PREFERENCES.find(route =>

            route.from.includes(from) &&
            route.to.includes(to)

        );


    if (preference) {

        return preference.preferred
            .map(code =>
                ROUTE_HUBS.find(
                    hub => hub.code === code
                )
            )
            .filter(Boolean);

    }


    /*
        If exact route isn't in our preference map,
        use a sensible default order.

        This is still much better than randomly
        trying Bhopal/Ujjain for every destination.
    */

    return [

        "NDLS",
        "AGC",
        "KOTA",
        "BPL",
        "UJN",
        "ALD",
        "NGP"

    ]
        .map(code =>
            ROUTE_HUBS.find(
                hub => hub.code === code
            )
        )
        .filter(Boolean);
}


// ======================================================
// GET REAL TRAINS BETWEEN TWO STATIONS
// ======================================================

async function getAlternativeTrains(
    from,
    to
) {

    const url =
        `https://api.railradar.in/v1/trains/between/` +
        `${encodeURIComponent(from)}/` +
        `${encodeURIComponent(to)}`;


    const response =
        await fetch(url, {

            method: "GET",

            headers: {

                "Authorization":
                    `Bearer ${API_KEY}`,

                "Content-Type":
                    "application/json"

            }

        });


    const data =
        await response.json();


    if (!response.ok) {

        throw new Error(
            data?.error?.message ||
            "RailRadar request failed"
        );

    }


    return data;

}


// ======================================================
// ALTERNATIVE ROUTES API
// ======================================================

app.get(
    "/api/alternative-routes",
    async (req, res) => {

        try {

            const from =
                (req.query.from || "")
                    .trim()
                    .toUpperCase();


            const to =
                (req.query.to || "")
                    .trim()
                    .toUpperCase();


            // ------------------------------------------
            // VALIDATION
            // ------------------------------------------

            if (!from || !to) {

                return res.status(400).json({

                    success: false,

                    message:
                        "From and To station codes are required."

                });

            }


            if (from === to) {

                return res.status(400).json({

                    success: false,

                    message:
                        "From and To stations cannot be same."

                });

            }


            console.log(
                `🔎 Smart route search: ${from} → ${to}`
            );


            // ==========================================
            // DIRECT ROUTE
            // ==========================================

            let directData = null;


            try {

                directData =
                    await getAlternativeTrains(
                        from,
                        to
                    );

            }

            catch (error) {

                console.log(
                    "Direct route error:",
                    error.message
                );

            }


            const directTrains =
                directData?.data?.trains || [];


            // ==========================================
            // GET SMART HUBS
            // ==========================================

            const hubs =
                getPreferredHubs(
                    from,
                    to
                );


            console.log(
                "Preferred hubs:",
                hubs.map(h => h.code)
            );


            // ==========================================
            // FIND ALTERNATIVES
            // ==========================================

            const alternatives = [];


            for (
                const hub of hubs
            ) {


                // Never use source or destination
                // as interchange.

                if (
                    hub.code === from ||
                    hub.code === to
                ) {

                    continue;

                }


                console.log(
                    `🔍 Checking ${from} → ${hub.code} → ${to}`
                );


                let firstData = null;

                let secondData = null;


                // --------------------------------------
                // FIRST LEG
                // --------------------------------------

                try {

                    firstData =
                        await getAlternativeTrains(
                            from,
                            hub.code
                        );

                }

                catch (error) {

                    console.log(
                        `${from} → ${hub.code} failed`
                    );

                    continue;

                }


                // --------------------------------------
                // SECOND LEG
                // --------------------------------------

                try {

                    secondData =
                        await getAlternativeTrains(
                            hub.code,
                            to
                        );

                }

                catch (error) {

                    console.log(
                        `${hub.code} → ${to} failed`
                    );

                    continue;

                }


                const firstTrains =
                    firstData?.data?.trains || [];


                const secondTrains =
                    secondData?.data?.trains || [];


                // --------------------------------------
                // ONLY ACCEPT REAL COMPLETE ROUTES
                // --------------------------------------

                if (
                    firstTrains.length === 0 ||
                    secondTrains.length === 0
                ) {

                    continue;

                }


                // --------------------------------------
                // ADD ROUTE
                // --------------------------------------

                alternatives.push({

                    via: {

                        code:
                            hub.code,

                        name:
                            hub.name

                    },


                    firstLeg: {

                        from:
                            from,

                        to:
                            hub.code,

                        trains:
                            firstTrains.slice(
                                0,
                                5
                            )

                    },


                    secondLeg: {

                        from:
                            hub.code,

                        to:
                            to,

                        trains:
                            secondTrains.slice(
                                0,
                                5
                            )

                    }

                });


                /*
                    Only return top 3 sensible
                    alternatives.
                */

                if (
                    alternatives.length >= 3
                ) {

                    break;

                }

            }


            // ==========================================
            // RESPONSE
            // ==========================================

            res.json({

                success: true,

                from:
                    from,

                to:
                    to,

                direct: {

                    available:
                        directTrains.length > 0,

                    count:
                        directTrains.length,

                    trains:
                        directTrains.slice(
                            0,
                            10
                        )

                },

                alternatives:
                    alternatives

            });


        }

        catch (error) {

            console.error(
                "❌ Smart alternative route error:",
                error
            );


            res.status(500).json({

                success: false,

                message:
                    "Unable to find alternative routes.",

                error:
                    error.message

            });

        }

    }
);

            // ==================================================
            // 3. RESPONSE
            // ==================================================

            res.json({

                success: true,

                from: from,

                to: to,

                direct: {

                    available:
                        directTrains.length > 0,

                    count:
                        directTrains.length,

                    trains:
                        directTrains.slice(0, 10)
                },

                alternatives:
                    alternatives

            });

        }

        catch (error) {

            console.error(
                "Alternative Route Error:",
                error
            );

            res.status(
                error.status || 500
            ).json({

                success: false,

                message:
                    "Unable to find alternative routes.",

                error:
                    error.message
            });
        }

    }
);

// ======================================================
// PNR STATUS
// ======================================================

app.get("/api/pnr/:pnr", async (req, res) => {

    try {

        const { pnr } = req.params;

        if (
            !pnr ||
            !/^\d{10}$/.test(pnr)
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Please provide a valid 10-digit PNR number."

            });

        }

        const url =
            `https://api.railradar.in/v1/pnr/${encodeURIComponent(
                pnr
            )}`;

        const response = await fetch(url, {

            headers: {

                "Authorization":
                    `Bearer ${API_KEY}`,

                "Content-Type":
                    "application/json"

            }

        });

        const data =
            await response.json();

        res.status(
            response.status
        ).json(data);

    }

    catch (error) {

        console.error(
            "PNR Error:",
            error.message
        );

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
// ================= RATINGS =============================
// ======================================================


// ------------------------------------------------------
// SUBMIT RATING
// ------------------------------------------------------

app.post("/api/ratings", async (req, res) => {

    try {

        const {
            trainNumber,
            comfort,
            food,
            staff,
            delay,
            other
        } = req.body;


        // Train number validation

        if (
            !trainNumber ||
            !String(trainNumber).trim()
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Please provide train number."

            });

        }


        // Convert ratings to numbers

        const values = {

            comfort:
                Number(comfort),

            food:
                Number(food),

            staff:
                Number(staff),

            delay:
                Number(delay)

        };


        // Validate 1-5

        for (
            const [key, value]
            of Object.entries(values)
        ) {

            if (
                !Number.isFinite(value) ||
                value < 1 ||
                value > 5
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        `${key} rating must be between 1 and 5.`

                });

            }

        }


        // Overall rating

        const overallRating =
            (
                values.comfort +
                values.food +
                values.staff +
                values.delay
            ) / 4;


        // Save in MongoDB

        const rating =
            await Rating.create({

                trainNumber:
                    String(trainNumber).trim(),

                comfort:
                    values.comfort,

                food:
                    values.food,

                staff:
                    values.staff,

                delay:
                    values.delay,

                other:
                    String(other || "").trim(),

                overallRating:
                    Number(
                        overallRating.toFixed(1)
                    )

            });


        res.status(201).json({

            success: true,

            message:
                "Feedback submitted successfully.",

            overallRating:
                rating.overallRating,

            data: {

                id:
                    rating._id,

                trainNumber:
                    rating.trainNumber,

                overallRating:
                    rating.overallRating

            }

        });

    }

    catch (error) {

        console.error(
            "Rating Submit Error:",
            error
        );

        res.status(500).json({

            success: false,

            message:
                "Unable to submit feedback.",

            error:
                error.message

        });

    }

});


// ------------------------------------------------------
// GET TRAIN RATINGS
// ------------------------------------------------------

app.get(
    "/api/ratings/:trainNumber",
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


            const ratings =
                await Rating.find({

                    trainNumber:
                        String(trainNumber).trim()

                })
                    .sort({
                        createdAt: -1
                    })
                    .limit(100);


            // No ratings yet

            if (ratings.length === 0) {

                return res.json({

                    success: true,

                    trainNumber:
                        trainNumber,

                    totalRatings:
                        0,

                    averageRating:
                        0,

                    categoryAverages: {

                        comfort: 0,

                        food: 0,

                        staff: 0,

                        delay: 0

                    },

                    data: []

                });

            }


            // Average helper

            const average = (field) => {

                return (
                    ratings.reduce(
                        (sum, rating) =>
                            sum +
                            Number(
                                rating[field] || 0
                            ),
                        0
                    ) /
                    ratings.length
                );

            };


            res.json({

                success: true,

                trainNumber:
                    trainNumber,

                totalRatings:
                    ratings.length,

                averageRating:
                    Number(
                        average(
                            "overallRating"
                        ).toFixed(1)
                    ),

                categoryAverages: {

                    comfort:
                        Number(
                            average(
                                "comfort"
                            ).toFixed(1)
                        ),

                    food:
                        Number(
                            average(
                                "food"
                            ).toFixed(1)
                        ),

                    staff:
                        Number(
                            average(
                                "staff"
                            ).toFixed(1)
                        ),

                    delay:
                        Number(
                            average(
                                "delay"
                            ).toFixed(1)
                        )

                },

                data:
                    ratings

            });

        }

        catch (error) {

            console.error(
                "Rating Fetch Error:",
                error
            );

            res.status(500).json({

                success: false,

                message:
                    "Unable to fetch ratings.",

                error:
                    error.message

            });

        }

    }
);


// ======================================================
// ============ SAVE TRAIN DELAY SNAPSHOT ===============
// ======================================================

async function collectTrainDelay(
    trainNumber
) {

    const data =
        await getLiveTrain(
            trainNumber
        );


    const liveData =
        data?.data || {};


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


    // Journey date

    const journeyDate =
        liveData?.startDate ||
        new Intl.DateTimeFormat(
            "en-CA",
            {
                timeZone:
                    "Asia/Kolkata"
            }
        ).format(
            new Date()
        );


    // Day of week

    const dayOfWeek =
        new Intl.DateTimeFormat(
            "en-US",
            {
                weekday: "long",
                timeZone:
                    "Asia/Kolkata"
            }
        ).format(
            new Date()
        );


    // Check existing record

    const existingRecord =
        await DelayHistory.findOne({

            trainNumber:
                realTrainNumber,

            journeyDate:
                journeyDate

        });


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


        return await existingRecord.save();

    }


    // Create new record

    return await DelayHistory.create({

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


// ======================================================
// MANUAL RELIABILITY COLLECTION
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
// GET DELAY HISTORY
// ======================================================

app.get(
    "/api/reliability/history/:trainNumber",
    async (req, res) => {

        try {

            const { trainNumber } =
                req.params;


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
// RELIABILITY ANALYZER
// ======================================================

app.get(
    "/api/reliability/:trainNumber",
    async (req, res) => {

        try {

            const { trainNumber } =
                req.params;


            // ------------------------------------------
            // CURRENT LIVE DATA
            // ------------------------------------------

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


            // ------------------------------------------
            // SAVE CURRENT SNAPSHOT
            // ------------------------------------------

            await collectTrainDelay(
                trainNumber
            );


            // ------------------------------------------
            // GET HISTORY
            // ------------------------------------------

            const history =
                await DelayHistory.find({

                    trainNumber:
                        trainNumber

                })
                    .sort({
                        journeyDate: -1
                    })
                    .limit(90);


            // ------------------------------------------
            // NOT ENOUGH DATA
            // ------------------------------------------

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

                        message:
                            "Not enough historical data yet. Collect more daily snapshots.",

                        totalRecords:
                            history.length,

                        currentDelay:
                            currentDelay

                    }

                });

            }


            // ------------------------------------------
            // DELAY VALUES
            // ------------------------------------------

            const delays =
                history.map(
                    record =>
                        Number(
                            record.delayMinutes || 0
                        )
                );


            // ------------------------------------------
            // AVERAGE
            // ------------------------------------------

            const averageDelay =
                delays.reduce(
                    (sum, value) =>
                        sum + value,
                    0
                ) /
                delays.length;


            // ------------------------------------------
            // MEDIAN
            // ------------------------------------------

            const sortedDelays =
                [...delays].sort(
                    (a, b) => a - b
                );


            const middle =
                Math.floor(
                    sortedDelays.length / 2
                );


            let medianDelay;


            if (
                sortedDelays.length % 2 === 0
            ) {

                medianDelay =
                    (
                        sortedDelays[middle - 1] +
                        sortedDelays[middle]
                    ) / 2;

            }

            else {

                medianDelay =
                    sortedDelays[middle];

            }


            // ------------------------------------------
            // LOW DELAY DAYS
            // <= 15 MIN
            // ------------------------------------------

            const lowDelayDays =
                delays.filter(
                    delay =>
                        delay <= 15
                ).length;


            const lowDelayPercentage =
                (
                    lowDelayDays /
                    delays.length
                ) * 100;


            // ------------------------------------------
            // MAJOR DELAY DAYS
            // > 60 MIN
            // ------------------------------------------

            const majorDelayDays =
                delays.filter(
                    delay =>
                        delay > 60
                ).length;


            const majorDelayPercentage =
                (
                    majorDelayDays /
                    delays.length
                ) * 100;


            // ------------------------------------------
            // DAY-WISE PATTERN
            // ------------------------------------------

            const dayGroups = {};


            history.forEach(
                record => {

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

                }
            );


            const dayWisePattern = {};


            Object.keys(dayGroups)
                .forEach(
                    day => {

                        const values =
                            dayGroups[day];


                        const avg =
                            values.reduce(
                                (sum, value) =>
                                    sum + value,
                                0
                            ) /
                            values.length;


                        dayWisePattern[day] =
                            Number(
                                avg.toFixed(1)
                            );

                    }
                );


            // ------------------------------------------
            // RAILINTEL SCORE
            // ------------------------------------------

            let score = 100;


            // Average delay

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

                score -= 0;

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


            // Major delay frequency

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
                    Math.min(
                        100,
                        Math.round(score)
                    )
                );


            // ------------------------------------------
            // STATUS
            // ------------------------------------------

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


            // ------------------------------------------
            // CURRENT VS AVERAGE
            // ------------------------------------------

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


            // ------------------------------------------
            // FINAL RESPONSE
            // ------------------------------------------

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
// AUTOMATIC DELAY COLLECTION
// ======================================================

// Every 12 hours

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
// START SERVER
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
// ================= LOGIN STATUS =================


// ================= LOGOUT =================

function logout() {

    localStorage.removeItem("railintelUser");

    window.location.href = "index.html";

}


// Run when page loads

startServer();