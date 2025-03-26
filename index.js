const net = require("net");
const childProcess = require("child_process");
const fs = require("fs");
const { EventEmitter } = require("events");

const { Server, Router } = require("http-js");

const config = require("./config.json");

const cameraStreams = { };
const cameraClients = { };
const cameraOffFrame = fs.existsSync(config.cameraOffPath) ? fs.readFileSync(config.cameraOffPath) : null;
const cameraErrorPath = fs.existsSync(config.cameraErrorPath) ? fs.readFileSync(config.cameraErrorPath) : null;

// API Server

const server = new Server();
const { router } = server;

// Camera

router.get("/camera/:camera/", async (req, res, next, params) => {
    if (!config.cameras?.[params.camera]) return next();
    try {
        res.json(await getCamera(params.camera))
    } catch (err) {
        res.sendStatus(500);
    }
});

router.post("/camera/:camera/on/", async (req, res, next, params) => {
    if (!config.cameras?.[params.camera]) return next();
    try {
        await setCamera(params.camera, true);
        res.sendStatus(204);
    } catch (err) {
        res.sendStatus(500);
    }
});

router.post("/camera/:camera/off/", async (req, res, next, params) => {
    if (!config.cameras?.[params.camera]) return next();
    try {
        await setCamera(params.camera, false);
        res.sendStatus(204);
    } catch (err) {
        res.sendStatus(500);
    }
});

router.get("/camera/:camera/stream/", (req, res, next, params) => {
    const camera = config.cameras?.[params.camera];
    if (!camera) return next();

    const cameraStream = cameraStreams[params.camera];

    const client = {
        req,
        res,
        queue: [],
        writing: false
    };

    const noFrameInterval = setInterval(() => {
        const frame = cameraStream.state === 0 ? cameraOffFrame : cameraStream.state === 2 ? cameraErrorPath : null;
        if (!frame) return;

        const data = Buffer.concat([
            Buffer.from(`--stream\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.byteLength}\r\n\r\n`),
            frame,
            Buffer.from("\r\n\r\n")
        ]);

        if (client.writing) {
            return client.queue.push(data);
        } else {
            if (!res.write(data)) {
                client.writing = true;
                res.once("drain", () => {
                    client.writing = false;
                    if (client.queue.length) res.write(client.queue.shift());
                });
            } else {
                if (client.queue.length) res.write(client.queue.shift());
            }
        }
    }, 1000 / 1);

    res.setHeader("Content-Type", "multipart/x-mixed-replace; boundary=stream");

    req.on("close", () => {
        const clientIndex = cameraClients[params.camera].indexOf(client);
        if (clientIndex >= 0) cameraClients[params.camera].splice(clientIndex, 1);
        clearInterval(noFrameInterval);
    });

    cameraClients[params.camera].push(client);
});

router.get("/camera/:camera/still/", (req, res, next, params) => {
    const camera = config.cameras?.[params.camera];
    if (!camera) return next();

    const cameraStream = cameraStreams[params.camera];

    if (cameraStream.state !== 1) return res.sendStatus(204);

    if (cameraStream.lastFrame) {
        res.send(cameraStream.lastFrame, "image/jpeg");
    } else {
        cameraStreams[params.camera].once("frame", frame => {
            res.send(frame, "image/jpeg");
        });
    }
});

// Light

router.get("/light/:light/", async (req, res, next, params) => {
    if (!config.lights?.[params.light]) return next();
    try {
        res.json(await getLight(params.light))
    } catch (err) {
        res.sendStatus(500);
    }
});

router.post("/light/:light/on/", async (req, res, next, params) => {
    if (!config.lights?.[params.light]) return next();
    try {
        await setLight(params.light, true);
        res.sendStatus(204);
    } catch (err) {
        res.sendStatus(500);
    }
});

router.post("/light/:light/off/", async (req, res, next, params) => {
    if (!config.lights?.[params.light]) return next();
    try {
        await setLight(params.light, false);
        res.sendStatus(204);
    } catch (err) {
        res.sendStatus(500);
    }
});

// PSU

router.get("/psu/:psu/", async (req, res, next, params) => {
    if (!config.psus?.[params.psu]) return next();
    try {
        res.json(await getPSU(params.psu));
    } catch (err) {
        res.sendStatus(500);
    }
});

router.post("/psu/:psu/on/", async (req, res, next, params) => {
    if (!config.psus?.[params.psu]) return next();
    try {
        await setPSU(params.psu, true);
        res.sendStatus(204);
    } catch (err) {
        res.sendStatus(500);
    }
});

router.post("/psu/:psu/off/", async (req, res, next, params) => {
    if (!config.psus?.[params.psu]) return next();
    try {
        await setPSU(params.psu, false);
        res.sendStatus(204);
    } catch (err) {
        res.sendStatus(500);
    }
});

router.any("*", (req, res) => {
    res.sendStatus(404);
});

// Listen
server.listen(config.port, () => console.log(`Server is running at :${config.port}`));

// Controls

function getCamera(cameraIndex) {
    const camera = config.cameras?.[cameraIndex];

    const cameraStream = cameraStreams[cameraIndex];

    return {
        state: cameraStream.state,
        startDate: cameraStream.startDate,
    };
}

function setCamera(cameraIndex, value) {
    const camera = config.cameras?.[cameraIndex];

    cameraStreams[cameraIndex][value ? "start" : "stop"]();

    console.log("[Camera]", `${camera.name ? `${camera.name} (${cameraIndex})` : cameraIndex} turned ${value ? "on" : "off"}`);

    if (camera.triggers) runTriggers(camera.triggers, value);
}

function getLight(lightIndex) {
    const light = config.lights?.[lightIndex];

    return {
        state: getGpioValue(light.gpio)
    };
}

function setLight(lightIndex, value) {
    const light = config.lights?.[lightIndex];

    setGpio(light.gpio, value);
    
    console.log("[Light]", `${light.name ? `${light.name} (${lightIndex})` : lightIndex} turned ${value ? "on" : "off"}`);
    
    if (light.triggers) runTriggers(light.triggers, value);
}

function getPSU(psuIndex) {
    const psu = config.psus?.[psuIndex];

    if (!psu.type || psu.type === "gpio") {
        return {
            state: getGpioValue(psu.gpio)
        };
    } else if (psu.type === "smarthomeprotocol") {
        return new Promise(async (resolve, reject) => {
            const data = await sendSmartHomeProtocolCommand(psu.address, { system: { get_sysinfo: null } }).catch(err => {
                console.log("Error sending Smart Home Protocol command:", err);
                return reject();
            });
        
            const info = data?.system?.get_sysinfo;
            if (!info || info.err_code) {
                console.log("Smart Home Protocol response isn't correct:", info);
                return reject();
            }

            resolve({
                state: info.relay_state,
                onSince: info.relay_state ? new Date(Math.floor(Date.now() / 1000 - info.on_time) * 1000) : null,
                mac: info.mac
            });
        });
    }
}

function setPSU(psuIndex, value) {
    return new Promise(async (resolve, reject) => {
        const psu = config.psus?.[psuIndex];

        if (!psu.type || psu.type === "gpio") {
            setGpio(psu.gpio, value);
        } else if (psu.type === "smarthomeprotocol") {
            const data = await sendSmartHomeProtocolCommand(psu.address, { system: { set_relay_state: { state: value ? 1 : 0 } } }).catch(err => {
                console.log("Error sending Smart Home Protocol command:", err);
                return reject();
            });
        
            const info = data?.system?.set_relay_state;
            if (!info || info.err_code) {
                console.log("Smart Home Protocol response isn't correct:", info);
                return reject();
            }
        }

        resolve();

        console.log("[PSU]", `${psu.name ? `${psu.name} (${psuIndex})` : psuIndex} turned ${value ? "on" : "off"}`);

        if (psu.triggers) runTriggers(psu.triggers, value);
    });
}

async function runTriggers(triggers, value) {
    for (const trigger of triggers) {
        try {
            const [type, index, reversed] = trigger.split(":");
            const isReversed = (reversed === "1" || reversed === "true") ? true : false;
            
            if (type === "camera") await setCamera(index, isReversed ? !value : value); else
            if (type === "light") await setLight(index, isReversed ? !value : value); else
            if (type === "psu") await setPSU(index, isReversed ? !value : value); else
            throw new Error(`Unknown type '${type}'`);
        } catch (err) {
            console.log(`Failed to run trigger '${trigger}': ${err}`);
        }
    }
}

// Camera streams

class CameraStream extends EventEmitter {
    constructor(camera, options = { }) {
        super();
        
        this.camera = camera;
        if (options.ffmpegPath) this.ffmpegPath = options.ffmpegPath;
        if (options.storeLastFrame) this.storeLastFrame = options.storeLastFrame;
        if (options.ffmpegInputArgs) this.ffmpegInputArgs = options.ffmpegInputArgs;
        if (options.ffmpegOutputArgs) this.ffmpegOutputArgs = options.ffmpegOutputArgs;
        if (options.logs) this.logs = options.logs;
        if (options.logSize) this.logSize = options.logSize;
        this.options = options;
    }

    camera = null;
    ffmpegPath = "ffmpeg";
    storeLastFrame = false;
    ffmpegInputArgs = [];
    ffmpegOutputArgs = [];
    logs = false;
    logSize = 1024;
    
    log = "";
    ffmpegProcess = null;
    lastFrame = null;
    state = 0;
    startDate = null;

    start() {
        if (this.state === 1) return;

        this.ffmpegProcess = childProcess.spawn(this.ffmpegPath ?? "ffmpeg", [
            ...this.ffmpegInputArgs ?? [],
            "-i", this.camera.path,
            ...this.ffmpegOutputArgs ?? [],
            "-c:v", "mjpeg",
            "-f", "mjpeg",
            "-"
        ]);

        const frameArrayBuffer = [];

        this.ffmpegProcess.on("spawn", () => {
            this.state = 1;
            this.startDate = new Date();
            this.emit("start");
        });

        this.ffmpegProcess.stdout.on("data", data => {
            frameArrayBuffer.push(data);

            if (data[data.byteLength - 2] === 0xFF && data[data.byteLength - 1] === 0xD9) {
                const frameBuffer = Buffer.concat(frameArrayBuffer);
                frameArrayBuffer.length = 0;
                if (this.storeLastFrame) this.lastFrame = frameBuffer;
                this.emit("frame", frameBuffer);
            }
        });

        this.ffmpegProcess.stderr.on("data", data => {
            if (!this.logs) return;
            const log = data.toString();
            this.log += log;
            if (this.logSize && this.log.length > this.logSize) this.log = this.log.slice(-this.options.logSize);
        });

        this.ffmpegProcess.on("error", err => {
            this.state = 2;
            this.emit("error", err);
        });
        
        this.ffmpegProcess.on("close", code => {
            if (this.state === 1) {
                if (code > 0) {
                    this.state = 2;
                    this.emit("error", this.log);
                } else {
                    this.state = 0;
                }
            }
            this.emit("close", code);
        });
    }

    stop() {
        if (this.ffmpegProcess) {
            this.ffmpegProcess.kill("SIGKILL");
            this.state = 0;
        }
    }
}

if (config.cameras) for (const cameraIndex in config.cameras) {
    const camera = config.cameras[cameraIndex];
    const cameraStream = new CameraStream(camera, {
        ffmpegInputArgs: camera.inputArgs,
        ffmpegOutputArgs: camera.outputArgs,
        logs: false
    });

    cameraStream.start();

    cameraStream.on("start", () => {
        console.log("[Camera]", `${camera.name ? `${camera.name} (${cameraIndex})` : cameraIndex} started`);
    });

    cameraStream.on("frame", frame => {
        for (const cameraClient of cameraClients[cameraIndex]) {
            const data = Buffer.concat([
                Buffer.from(`--stream\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.byteLength}\r\n\r\n`),
                frame,
                Buffer.from("\r\n\r\n")
            ]);

            if (cameraClient.writing) {
                return cameraClient.queue.push(data);
            } else {
                if (!cameraClient.res.write(data)) {
                    cameraClient.writing = true;
                    cameraClient.res.once("drain", () => {
                        cameraClient.writing = false;
                        if (cameraClient.queue.length) cameraClient.res.write(cameraClient.queue.shift());
                    });
                } else {
                    if (cameraClient.queue.length) cameraClient.res.write(cameraClient.queue.shift());
                }
            }
        }
    });

    cameraStream.on("close", () => {
        console.log("[Camera]", `${camera.name ? `${camera.name} (${cameraIndex})` : cameraIndex} closed`);
    });

    cameraStream.on("error", err => {
        console.log("[Camera]", `${camera.name ? `${camera.name} (${cameraIndex})` : cameraIndex} had an error:`, err);
        if (config.cameraRetryInterval) setTimeout(() => {
            if (cameraStream.state === 2) cameraStream.start()
        }, config.cameraRetryInterval);
    });

    cameraStreams[cameraIndex] = cameraStream;
    cameraClients[cameraIndex] = [];
}

// GPIO

function setGpio(pin, value, direction = "output") {
    const writeDirection = direction === "output" ? "out" : direction === "input" ? "in" : "out";
    const writeValue = `${value === false ? 0 :  value === true ? 1 : value}\n`;

    // Export pin
    if (!fs.existsSync(`/sys/class/gpio/gpio${pin}`)) {
        fs.writeFileSync("/sys/class/gpio/export", `${pin}`);
    }
    // Set direction
    if (fs.readFileSync(`/sys/class/gpio/gpio${pin}/direction`, "utf-8") !== writeDirection) {
        fs.writeFileSync(`/sys/class/gpio/gpio${pin}/direction`, `${writeDirection}`);
    }
    // Set value
    fs.writeFileSync(`/sys/class/gpio/gpio${pin}/value`, `${writeValue}`);
}

function getGpioValue(pin) {
    if (!fs.existsSync(`/sys/class/gpio/gpio${pin}`)) return null;
    return parseInt(fs.readFileSync(`/sys/class/gpio/gpio${pin}/value`, "utf-8"));
}

// TP-Link Smart Home Protocol Proxy

if (config.smartHomeProtocolProxy) {
    const smartHomeProtocolProxy = net.createServer();

    smartHomeProtocolProxy.on("connection", socket => {
        const connection = net.createConnection({
            host: config.plugAddress,
            port: config.plugPort ?? 9999
        });

        connection.on("data", data => !socket.write(data) && connection.pause());
        connection.on("end", () => socket.end());
        connection.on("drain", () => socket.resume());
        connection.on("error", () => socket.end());

        socket.on("data", data => !connection.write(data) && socket.pause());
        socket.on("end", () => connection.end());
        socket.on("drain", () => connection.resume());
        socket.on("error", () => connection.end());
    });

    smartHomeProtocolProxy.listen(9999, () => console.log(`TP-Link Smart Home protocol proxy is running at :${config.plugPort ?? 9999}`));
}

// TP-Link Smart Home Protocol

function sendSmartHomeProtocolCommand(address, command) {
    return new Promise((resolve, reject) => {
        const connection = net.createConnection({ host: address, port: 9999 });
        connection.write(smartHomeProtocolEncrypt(JSON.stringify(command)));
        let data;
        connection.on("data", i => data = Buffer.concat(data ? [data, i] : [i]));
        connection.on("end", () => resolve(JSON.parse(smartHomeProtocolDecrypt(data))));
        connection.on("error", err => reject(err));
    });
}

function smartHomeProtocolEncrypt(string) {
    let key = 171;
    const length = string.length;
    const result = new Uint8Array(4 + length);

    result[0] = (length >> 24) & 0xFF;
    result[1] = (length >> 16) & 0xFF;
    result[2] = (length >> 8) & 0xFF;
    result[3] = length & 0xFF;

    for (let i = 0; i < string.length; i++) {
        const a = key ^ string.charCodeAt(i);
        key = a;
        result[4 + i] = a;
    }

    return result;
}

function smartHomeProtocolDecrypt(array) {
    let key = 171;
    let result = "";

    for (let i = 4; i < array.length; i++) {
        const a = key ^ array[i];
        key = array[i];
        result += String.fromCharCode(a);
    }

    return result;
}