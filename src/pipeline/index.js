import moment from "moment-timezone";
import {merge, partial, prop} from "ramda";
import sift from "sift";
import {inspect} from "util";

import * as config from "./common/config";
import * as dynamodb from "./common/dynamodb";
import * as sns from "./common/sns";

var log = function log (message) {
    var i = 0;
    return function () {
        if (!config.DEBUG) {
            return;
        }
        if (i === 0) {
            console.log(message);
        }
        console.log(inspect(arguments));
    };
};

var getAlarmsByPod = function getAlarmsByPod (podId) {
    return dynamodb.scan({
        TableName: config.ALARMS_TABLE_NAME,
        ExpressionAttributeValues: {
            ":podId": {
                S: podId
            }
        },
        FilterExpression: "podId = :podId"
    }).then(prop("Items"));
};

var replaceDate = function replaceDate (podReading) {
    var date = moment(podReading.date).utc();
    return merge(podReading, {
        date: {
            millisecond: date.millisecond(),
            second: date.second(),
            minute: date.minute(),
            hour: date.hour(),
            monthDay: date.date(),
            weekDay: date.isoWeekday(),
            week: date.isoWeek(),
            month: date.month(),
            year: date.year()
        }
    });
};

var check = function check (podReading, alarm) {
    podReading = replaceDate(podReading);
    return sift(alarm.rule)(podReading);
};

var trigger = function trigger (podReading, alarm) {
    return sns.publish({
        Message: [
            `Pod reading ${podReading.id}`,
            `from site ${podReading.podId}`,
            `triggered alarm ${alarm.name}`,
            `on ${moment(podReading.date).tz(config.TIMEZONE).format("llll")}`
        ].join("\n"),
        Subject: "Triggered alarm",
        TopicArn: config.ALARMS_TOPIC_ARN
    });
};

export default function pipeline (event) {
    var podReading = merge(event.data.element, {
        id: event.data.id
    });
    return getAlarmsByPod(podReading.podId)
        .map(log("Alarms by pod:"))
        .filter(partial(check, podReading))
        .map(log("Alarms that passed the check:"))
        .map(partial(trigger, podReading))
        .map(log("SNS responses:"));
}
