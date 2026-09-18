const mongoose = require("mongoose");

const delayHistorySchema = new mongoose.Schema(
    {
        trainNumber: {
            type: String,
            required: true,
            index: true
        },

        trainName: {
            type: String,
            default: "Unknown Train"
        },

        journeyDate: {
            type: String,
            required: true
        },

        delayMinutes: {
            type: Number,
            default: 0
        },

        status: {
            type: String,
            default: "unknown"
        },

        currentStation: {
            type: String,
            default: "-"
        },

        nextStation: {
            type: String,
            default: "-"
        },

        capturedAt: {
            type: Date,
            default: Date.now
        },

        dayOfWeek: {
            type: String,
            default: ""
        }
    },
    {
        timestamps: true
    }
);

const DelayHistory = mongoose.model(
    "DelayHistory",
    delayHistorySchema
);

module.exports = DelayHistory;