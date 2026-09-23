const mongoose = require("mongoose");

const ratingSchema = new mongoose.Schema(
    {
        trainNumber: {
            type: String,
            required: true,
            index: true
        },

        comfort: {
            type: Number,
            required: true,
            min: 1,
            max: 5
        },

        food: {
            type: Number,
            required: true,
            min: 1,
            max: 5
        },

        staff: {
            type: Number,
            required: true,
            min: 1,
            max: 5
        },

        delay: {
            type: Number,
            required: true,
            min: 1,
            max: 5
        },

        overallRating: {
            type: Number,
            required: true,
            min: 1,
            max: 5
        },

        other: {
            type: String,
            default: ""
        }
    },

    {
        timestamps: true
    }
);


const Rating =
    mongoose.model("Rating", ratingSchema);


module.exports = Rating;