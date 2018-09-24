/*jslint node: true */
"use strict";
const fs = require('fs');
const util = require('util');
const conf = require("byteballcore/conf.js");
const crypto = require('crypto');
const device = require('byteballcore/device.js');
const eventBus = require('byteballcore/event_bus.js');
const readline = require("readline");
const desktopApp = require('byteballcore/desktop_app.js');
require('byteballcore/wallet.js');

const DATA_DIR = desktopApp.getAppDataDir();
const KEYS_FILENAME = DATA_DIR + "/" + conf.KEYS_FILENAME;
const HUB = conf.hub;
const DEVICE_NAME = conf.deviceName;

var rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true
});
rl.setPrompt(DEVICE_NAME + "> ");

function readKeys(onDone) {
    fs.readFile(KEYS_FILENAME, 'utf8', function(err, data) {
        if (err) {
            console.log('failed to read keys, will gen');
            var devicePrivKey = crypto.randomBytes(32);
            var deviceTempPrivKey = crypto.randomBytes(32);
            var devicePrevTempPrivKey = crypto.randomBytes(32);
            writeKeys(devicePrivKey, deviceTempPrivKey, devicePrevTempPrivKey, function() {
                onDone(devicePrivKey, deviceTempPrivKey, devicePrevTempPrivKey);
            });
            return;
        }
        var keys = JSON.parse(data);
        onDone(Buffer(keys.permanent_priv_key, 'base64'), Buffer(keys.temp_priv_key, 'base64'), Buffer(keys.prev_temp_priv_key, 'base64'));
    });
}

function writeKeys(devicePrivKey, deviceTempPrivKey, devicePrevTempPrivKey, onDone) {
    var keys = {
        permanent_priv_key: devicePrivKey.toString('base64'),
        temp_priv_key: deviceTempPrivKey.toString('base64'),
        prev_temp_priv_key: devicePrevTempPrivKey.toString('base64')
    };

    console.log("Writing keys to " + KEYS_FILENAME);

    fs.writeFile(KEYS_FILENAME, JSON.stringify(keys), 'utf8', function(err) {
        if (err)
            throw Error("failed to write keys file");
        if (onDone)
            onDone();
    });
}

function replaceConsoleLog() {
    var log_filename = conf.LOG_FILENAME || (DATA_DIR + '/log.txt');
    var writeStream = fs.createWriteStream(log_filename);
    console.log('---------------');
    console.log('From this point, output will be redirected to ' + log_filename);
    console.log = function() {
        writeStream.write(Date().toString() + ': ');
        writeStream.write(util.format.apply(null, arguments) + '\n');
    };
    console.warn = console.log;
    console.info = console.log;
}

function out() {
    process.stdout.write(util.format.apply(null, arguments) + '\n');
}

function acceptInvitation(hub_host, device_pubkey, pairing_secret, cb) {
    //return setTimeout(cb, 5000);
    if (device_pubkey === device.getMyDevicePubKey())
        return cb("cannot pair with myself");
    // the correspondent will be initially called 'New', we'll rename it as soon as we receive the reverse pairing secret back
    device.addUnconfirmedCorrespondent(device_pubkey, hub_host, 'New', function(device_address) {
        device.startWaitingForPairing(function(reversePairingInfo) {
            device.sendPairingMessage(hub_host, device_pubkey, pairing_secret, reversePairingInfo.pairing_secret, {
                ifOk: cb,
                ifError: cb
            });
        });
    });
}

readKeys(function(devicePrivKey, deviceTempPrivKey, devicePrevTempPrivKey) {
    var saveTempKeys = function(new_temp_key, new_prev_temp_key, onDone) {
        writeKeys(devicePrivKey, new_temp_key, new_prev_temp_key, onDone);
    };
    device.setDevicePrivateKey(devicePrivKey);
    device.setTempKeys(deviceTempPrivKey, devicePrevTempPrivKey, saveTempKeys);
    device.setDeviceName(DEVICE_NAME);
    device.setDeviceHub(HUB);
    var my_device_pubkey = device.getMyDevicePubKey();
    console.log("my device pubkey: " + my_device_pubkey);
    console.log("my pairing code: " + my_device_pubkey + "@" + HUB + "#0000");

    replaceConsoleLog();

    rl.question('Enter pairing code of the other device: ', (pairingCode) => {
        let matches = pairingCode.match(/^(?:\w+:)?([\w\/+]+)@([\w.:\/-]+)#([\w\/+-]+)$/);
        if (!matches)
            return out("Invalid pairing code");

        let pubkey = matches[1];
        let hub = matches[2];
        let pairing_secret = matches[3];

        if (pubkey.length !== 44)
            return out("Invalid pubkey length");

        acceptInvitation(hub, pubkey, pairing_secret, function(result) {
            if (result) return out(result);
            console.log("Invitation accepted to " + pubkey);
        });
    });

});

eventBus.on('paired', function(from_address) {
    rl.on("line", function(line) {
        device.sendMessageToDevice(from_address, "text", line);
    });
});

eventBus.on("text", function(from_address, text) {
    device.readCorrespondent(from_address, function(correspondent) {
        out(correspondent.name + "> " + text);
        rl.prompt(true);
    });
});
