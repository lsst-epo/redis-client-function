"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const redis_1 = require("redis");
require("dotenv/config");
const { Logging } = require('@google-cloud/logging');
const { response } = require("express");
const ff = __importStar(require("@google-cloud/functions-framework"));
// Initialize logger
// const logging = new Logging("memcheck");
// const log = logging.log("memcheck-logger");
ff.http('handler', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    console.log("Got to the redis-client-test endpoint!!");
    const client = (0, redis_1.createClient)({
        url: `redis://${process.env.REDIS_USERNAME}:${process.env.REDIS_PASS}@${process.env.REDIS_IP}:${process.env.REDIS_PORT}`,
        password: "foobaredz"
    });
    client.on('error', err => console.log('Redis Client Error', err));
    console.log("about to connect to Redis");
    yield client.connect();
    yield client.hSet('user-session:123', {
        result: "_result",
        table: 0,
        dewPoint: -27.199665069580078,
        windDirection: 220.99395751953125,
        pressure0: 74100,
        relativeHumidity: 3.4700000286102295,
        windSpeed: 0.7505999803543091,
        temperature0: 16.84000015258789
    });
    let summitData = yield client.hGetAll('user-session:123');
    console.log(JSON.stringify(summitData, null, 2));
    return res.status(200).send(summitData);
}));
// async function writeLog(text: string, severity:string = "INFO") {
//     const metadata = {
//         resource: {type: 'global'},
//         // See: https://cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry#logseverity
//         severity: severity,
//     };
//     const entry = log.entry(metadata, text);
//     await log.write(entry);
// }
