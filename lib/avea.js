"use strict";

const Queue = require("promise-queue");
const Color = require("./color");
const winston = require("winston");

let SERVICE_ID = "f815e810456c6761746f4d756e696368";
let CHARACTERISTIC_ID = "f815e811456c6761746f4d756e696368";

class Avea {
    constructor(peripheral) {
        this.peripheral = peripheral;
        this.connected = false;
        this.characteristic = null;
        this.running = false;
        this.commandQueue = [];
        winston.debug("new bulb found", { bulb: this.id() });

        peripheral.on("connect", () => {
            this.connected = true;
            winston.debug("connected", { bulb: this.id() });
        });
        peripheral.on("disconnect", () => {
            this.connected = false;
            winston.debug("disconnected", { bulb: this.id() });
        });
    }

    id() {
        return this.peripheral.id;
    }

    connect() {
        return new Promise((resolve, reject) => {
            if (this.connected && this.peripheral.state === "connected") {
                resolve();
                return;
            }
            const timeout = setTimeout(() => {
                winston.error("failed to connect", { bulb: this.id() });
                reject(err);
            }, 1000 * 30);
            winston.debug("connecting", { bulb: this.id() });
            this.peripheral.connect((err) => {
                clearTimeout(timeout);
                this.characteristic = null;
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });

        });
    }


    getName() {
        return new Promise((resolve, reject) => {
            this._write(new Buffer([0x58])).then((response) => {
                // remove null termination from name
                resolve(response.toString("utf8", 0, response.length - 1));
            });
        });
    }

    getColor() {
        return new Promise((resolve, reject) => {
            this._write(new Buffer([0x35])).then((response) => {
                resolve(Color.fromResponse(response.slice(3, response.length)));
            });
        })
    }

    setColor(color, delay) {
        delay = delay || 100;
        const header = new Buffer([
            0x35,
            0x00,
            0x00,
            10,
            0,
        ]);
        header.writeUInt16LE(delay, 1);

        const buffer = Buffer.concat([header, color.toBuffer()]);
        winston.debug("setColor", { bulb: this.id(), color: color, delay: delay });

        return this._write(new Buffer(buffer));
    }


    getBrightness() {
        return new Promise((resolve, reject) => {
            this._write(new Buffer([0x57])).then((response) => {
                resolve(response.readInt16LE());
            });
        });
    }

    setBrightness(brightness) {
        const buffer = new Buffer([
            0x57, 0x00, 0x00,
        ]);
        buffer.writeInt16LE(brightness, 1);
        winston.debug("setBrighness", { bulb: this.id(), brightness: brightness });
        return this._write(new Buffer(buffer));
    }

    _getCharacteristic() {
        return this.connect().then(() => {
            return new Promise((resolve, reject) => {
                if (null !== this.characteristic) {
                    resolve(this.characteristic);
                } else {
                    this.peripheral.discoverSomeServicesAndCharacteristics([SERVICE_ID], [CHARACTERISTIC_ID], (err, services, characteristics) => {
                        if (err) {
                            return reject(err);
                        }

                        this.characteristic = characteristics[0];

                        this.characteristic.notify(true, (err) => {
                            resolve(characteristics[0]);
                        });
                    });
                }
            });
        });
    }

    _write(buffer) {
        return new Promise((resolve, reject) => {
            this.commandQueue.push([buffer, resolve, reject]);
            this._run();
        })
    }

    _run() {
        if (this.running) {
            return;
        }
        if (this.commandQueue.length == 0) {
            return;
        }

        this.running = true;
        this._getCharacteristic().then((characteristic) => {
            let queue = new Queue(1, Infinity);
            while (this.commandQueue.length > 0) {
                let command = this.commandQueue.shift();
                queue.add(() => { return this._writeAndWaitForResponse(characteristic, command[0]); })
                    .then((data) => {
                        command[1](data);
                    });
            }
            this.running = false;
        });
    }

    _writeAndWaitForResponse(characteristic, buffer) {
        return new Promise((resolve, reject) => {
            let listener = (data, isNotification) => {
                if (data[0] === buffer[0]) {
                    characteristic.removeListener("data", listener);
                    winston.debug("received", { bulb: this.id(), data: data.toString("hex") });
                    resolve(data.slice(1, data.length));
                }
            };
            characteristic.on("data", listener);
            winston.debug({ bulb: this.id(), data: buffer.toString("hex") });
            characteristic.write(buffer, true, (error) => {
                if (error) {
                    reject(error);
                }
            });
        });
    }
}

module.exports = Avea;
